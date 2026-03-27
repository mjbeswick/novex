import type { ParsedContent, Chapter } from "../types.ts";
import JSZip from "jszip";
import { parse as parseHtml } from "node-html-parser";
import { htmlToPlainText } from "./utils.ts";
import path from "path";

/**
 * Convert an EPUB buffer into a ParsedContent structure.
 *
 * Process:
 *  1. Unzip the EPUB with jszip
 *  2. Parse META-INF/container.xml to find the OPF rootfile
 *  3. Parse the OPF manifest and spine to get item reading order
 *  4. Extract HTML content for each spine item
 *  5. Derive chapter titles from NCX/nav TOC or in-document headings
 *  6. Return ParsedContent
 */
export async function convertEpub(
  buffer: Uint8Array,
  source: string,
  hash: string
): Promise<ParsedContent> {
  const fileBasename =
    source !== "stdin" ? path.basename(source, path.extname(source)) : "epub";

  const zip = await JSZip.loadAsync(buffer);

  // --- 1. Parse container.xml ---
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) {
    throw new Error("Invalid EPUB: missing META-INF/container.xml");
  }
  const containerXml = await containerFile.async("text");
  const containerRoot = parseHtml(containerXml, { lowerCaseTagName: true });
  const rootfileEl = containerRoot.querySelector("rootfile");
  if (!rootfileEl) {
    throw new Error("Invalid EPUB: no rootfile element in container.xml");
  }
  const opfPath = rootfileEl.getAttribute("full-path");
  if (!opfPath) {
    throw new Error("Invalid EPUB: rootfile has no full-path attribute");
  }

  // OPF base directory (for resolving relative hrefs)
  const opfDir = opfPath.includes("/")
    ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
    : "";

  // --- 2. Parse OPF ---
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
  }
  const opfXml = await opfFile.async("text");
  const opfRoot = parseHtml(opfXml, { lowerCaseTagName: true });

  // Extract document title from OPF metadata
  let docTitle = fileBasename;
  const dcTitle = opfRoot.querySelector("dc\\:title, title");
  if (dcTitle) {
    const t = dcTitle.text.trim();
    if (t) docTitle = t;
  }

  // Build manifest: id → { href, mediaType }
  const manifest: Map<string, { href: string; mediaType: string }> = new Map();
  const manifestItems = opfRoot.querySelectorAll("manifest item");
  for (const item of manifestItems) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") ?? "";
    if (id && href) {
      manifest.set(id, { href, mediaType });
    }
  }

  // Build spine: ordered list of idref values
  const spineItems = opfRoot.querySelectorAll("spine itemref");
  const spineIdrefs: string[] = [];
  for (const itemref of spineItems) {
    const idref = itemref.getAttribute("idref");
    if (idref) spineIdrefs.push(idref);
  }

  // --- 3. Try to load NCX or nav TOC for chapter titles ---
  const tocTitles = await loadTocTitles(zip, opfRoot, manifest, opfDir);

  // --- 4. Extract chapters from spine ---
  const chapters: Chapter[] = [];
  let chapterIndex = 0;

  for (const idref of spineIdrefs) {
    const manifestEntry = manifest.get(idref);
    if (!manifestEntry) continue;

    const { href, mediaType } = manifestEntry;
    if (
      !mediaType.includes("html") &&
      !mediaType.includes("xhtml") &&
      !href.match(/\.x?html?$/i)
    ) {
      continue;
    }

    const fullPath = opfDir + href;
    const chapterFile = zip.file(fullPath) ?? zip.file(href);
    if (!chapterFile) continue;

    const chapterHtml = await chapterFile.async("text");
    const bodyHtml = extractBody(chapterHtml);

    // Determine chapter title: prefer TOC entry, then in-document heading
    const title =
      tocTitles.get(href) ??
      tocTitles.get(fullPath) ??
      extractHeadingTitle(bodyHtml) ??
      `Chapter ${chapterIndex + 1}`;

    const text = htmlToPlainText(bodyHtml);

    chapters.push({
      title,
      html: bodyHtml,
      text,
      index: chapterIndex++,
    });
  }

  // Fallback: treat the whole zip as one chapter if spine gave nothing
  if (chapters.length === 0) {
    const html = "<p>Could not extract content from EPUB.</p>";
    chapters.push({
      title: docTitle,
      html,
      text: htmlToPlainText(html),
      index: 0,
    });
  }

  const fullHtml = chapters.map((c) => c.html).join("\n");
  const fullText = htmlToPlainText(fullHtml);

  // Extract cover image if available
  return {
    html: fullHtml,
    text: fullText,
    title: docTitle,
    source,
    hash,
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the inner content of <body> from an HTML/XHTML string.
 * Falls back to the full string if no body tag is found.
 */
function extractBody(html: string): string {
  const root = parseHtml(html, { lowerCaseTagName: true });
  const body = root.querySelector("body");
  return body ? body.innerHTML : html;
}

/**
 * Extract the text of the first <h1> or <h2> heading in an HTML fragment.
 */
function extractHeadingTitle(html: string): string | null {
  const root = parseHtml(html, { lowerCaseTagName: true });
  const heading = root.querySelector("h1, h2");
  if (heading) {
    const t = heading.text.trim();
    if (t) return t;
  }
  return null;
}

/**
 * Load chapter titles from the NCX or EPUB3 nav document.
 * Returns a map from (possibly relative) href → title.
 */
async function loadTocTitles(
  zip: JSZip,
  opfRoot: ReturnType<typeof parseHtml>,
  manifest: Map<string, { href: string; mediaType: string }>,
  opfDir: string
): Promise<Map<string, string>> {
  const titles: Map<string, string> = new Map();

  // Try EPUB3 nav document first
  for (const [, entry] of manifest) {
    if (entry.mediaType === "application/xhtml+xml" || entry.href.endsWith("nav.xhtml")) {
      const fullPath = opfDir + entry.href;
      const navFile = zip.file(fullPath) ?? zip.file(entry.href);
      if (!navFile) continue;
      const navXml = await navFile.async("text");
      const navRoot = parseHtml(navXml, { lowerCaseTagName: true });
      const navEl = navRoot.querySelector('nav[epub\\:type="toc"], nav[type="toc"], nav');
      if (!navEl) continue;

      const links = navEl.querySelectorAll("a");
      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href) continue;
        // Strip fragment identifiers
        const hrefBase = href.split("#")[0];
        const title = link.text.trim();
        if (hrefBase && title) {
          titles.set(hrefBase, title);
        }
      }
      if (titles.size > 0) return titles;
    }
  }

  // Try NCX (EPUB2)
  for (const [, entry] of manifest) {
    if (
      entry.mediaType === "application/x-dtbncx+xml" ||
      entry.href.endsWith(".ncx")
    ) {
      const fullPath = opfDir + entry.href;
      const ncxFile = zip.file(fullPath) ?? zip.file(entry.href);
      if (!ncxFile) continue;

      const ncxXml = await ncxFile.async("text");
      const ncxRoot = parseHtml(ncxXml, { lowerCaseTagName: true });
      const navPoints = ncxRoot.querySelectorAll("navpoint");

      for (const navPoint of navPoints) {
        const labelEl = navPoint.querySelector("navlabel text, text");
        const contentEl = navPoint.querySelector("content");
        if (!labelEl || !contentEl) continue;

        const title = labelEl.text.trim();
        const src = contentEl.getAttribute("src");
        if (!src || !title) continue;

        const hrefBase = src.split("#")[0];
        titles.set(hrefBase, title);
      }
      if (titles.size > 0) return titles;
    }
  }

  return titles;
}

/**
 * Extracts the cover image from an EPUB and returns it as a base64 data URL.
 */
async function extractCoverImage(
  zip: JSZip,
  opfRoot: any,
  manifest: Map<string, { href: string; mediaType: string }>,
  opfDir: string
): Promise<string | undefined> {
  // Look for cover image reference in metadata
  const metaEl = opfRoot.querySelector("metadata");
  if (!metaEl) return undefined;

  // Try to find cover meta tag (common in EPUB 3)
  const coverMeta = metaEl.querySelector("meta[name='cover'], meta[property='cover']");
  let coverId = coverMeta?.getAttribute("content");

  if (coverId && manifest.has(coverId)) {
    const coverItem = manifest.get(coverId);
    if (coverItem && coverItem.mediaType.startsWith("image/")) {
      const coverPath = path.join(opfDir, coverItem.href);
      const coverFile = zip.file(coverPath);
      if (coverFile) {
        try {
          const imageBuffer = await coverFile.async("arraybuffer");
          const base64 = Buffer.from(imageBuffer).toString("base64");
          // Determine MIME type
          const mimeType = coverItem.mediaType || "image/jpeg";
          return `data:${mimeType};base64,${base64}`;
        } catch {
          return undefined;
        }
      }
    }
  }

  // Fallback: look for first image in manifest
  for (const [, entry] of manifest) {
    if (entry.mediaType.startsWith("image/")) {
      const imagePath = path.join(opfDir, entry.href);
      const imageFile = zip.file(imagePath);
      if (imageFile) {
        try {
          const imageBuffer = await imageFile.async("arraybuffer");
          const base64 = Buffer.from(imageBuffer).toString("base64");
          const mimeType = entry.mediaType || "image/jpeg";
          return `data:${mimeType};base64,${base64}`;
        } catch {
          continue;
        }
      }
    }
  }

  return undefined;
}
