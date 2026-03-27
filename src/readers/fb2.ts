import type { ParsedContent, Chapter } from "../types.ts";
import { parse as parseHtml } from "node-html-parser";
import { htmlToPlainText, extractImages } from "./utils.ts";
import path from "path";

/**
 * Convert an FB2 buffer into a ParsedContent structure.
 * Parses the FB2 XML and converts body sections to chapters.
 */
export async function convertFb2(
  buffer: Uint8Array,
  source: string,
  hash: string
): Promise<ParsedContent> {
  const fileBasename =
    source !== "stdin" ? path.basename(source, path.extname(source)) : "stdin";

  const xmlText = new TextDecoder("utf-8").decode(buffer);

  // Parse the FB2 XML using node-html-parser in XML mode
  const root = parseHtml(xmlText, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: {},
  });

  // Extract book title from description/title-info
  let docTitle = fileBasename;
  const bookTitle = root.querySelector("book-title");
  if (bookTitle) {
    const t = bookTitle.text.trim();
    if (t) docTitle = t;
  }

  // Find body elements (skip notes bodies if possible)
  const bodyElements = root.querySelectorAll("body");
  const mainBodies =
    bodyElements.filter((b) => b.getAttribute("name") !== "notes").length > 0
      ? bodyElements.filter((b) => b.getAttribute("name") !== "notes")
      : bodyElements;

  const chapters: Chapter[] = [];
  let chapterIndex = 0;

  for (const body of mainBodies) {
    // Each top-level <section> in a body becomes a chapter
    const sections = body.querySelectorAll(":scope > section");

    if (sections.length === 0) {
      // No sections — treat the whole body as one chapter
      const html = convertFb2NodeToHtml(body.innerHTML);
      const text = htmlToPlainText(html);
      const title = extractSectionTitle(body.innerHTML) || docTitle;

      chapters.push({ title, html, text, index: chapterIndex++ });
    } else {
      for (const section of sections) {
        const html = convertFb2NodeToHtml(section.innerHTML);
        const text = htmlToPlainText(html);
        const title = extractSectionTitle(section.innerHTML) || docTitle;

        chapters.push({ title, html, text, index: chapterIndex++ });
      }
    }
  }

  // Fallback: if we got no chapters, wrap everything
  if (chapters.length === 0) {
    const html = `<p>${htmlToPlainText(xmlText)}</p>`;
    const text = htmlToPlainText(html);
    chapters.push({ title: docTitle, html, text, index: 0 });
  }

  const fullHtml = chapters.map((c) => c.html).join("\n");
  const fullText = htmlToPlainText(fullHtml);

  // Extract images from content
  const images = extractImages(fullHtml);

  return {
    html: fullHtml,
    text: fullText,
    title: docTitle,
    source,
    hash,
    chapters,
    images: images.size > 0 ? images : undefined,
  };
}

/**
 * Convert FB2 XML inner content to HTML.
 * Maps FB2-specific tags to their HTML equivalents.
 */
function convertFb2NodeToHtml(fb2Inner: string): string {
  let html = fb2Inner;

  // Map FB2 structural/formatting tags to HTML
  html = html
    // <title> inside FB2 sections → <h2>
    .replace(/<title>/gi, "<h2>")
    .replace(/<\/title>/gi, "</h2>")
    // <subtitle> → <h3>
    .replace(/<subtitle>/gi, "<h3>")
    .replace(/<\/subtitle>/gi, "</h3>")
    // <emphasis> → <em>
    .replace(/<emphasis>/gi, "<em>")
    .replace(/<\/emphasis>/gi, "</em>")
    // <strong> → <strong> (already HTML-compatible)
    // <epigraph> → <blockquote>
    .replace(/<epigraph>/gi, "<blockquote>")
    .replace(/<\/epigraph>/gi, "</blockquote>")
    // <cite> → <blockquote>
    .replace(/<cite>/gi, "<blockquote>")
    .replace(/<\/cite>/gi, "</blockquote>")
    // <poem> → <blockquote class="poem">
    .replace(/<poem>/gi, '<blockquote class="poem">')
    .replace(/<\/poem>/gi, "</blockquote>")
    // <stanza> → <p>
    .replace(/<stanza>/gi, "<p>")
    .replace(/<\/stanza>/gi, "</p>")
    // <v> (verse line) → line + <br>
    .replace(/<v>/gi, "")
    .replace(/<\/v>/gi, "<br>")
    // <text-author> → <cite>
    .replace(/<text-author>/gi, "<cite>")
    .replace(/<\/text-author>/gi, "</cite>")
    // <section> → <section>
    .replace(/<section>/gi, "<section>")
    .replace(/<\/section>/gi, "</section>")
    // <image> → skip (binary images not supported in terminal)
    .replace(/<image[^>]*\/>/gi, "")
    .replace(/<image[^>]*>[\s\S]*?<\/image>/gi, "")
    // <a ...> links — keep as-is
    // <p> — already HTML-compatible
    // Strip any remaining unknown FB2 tags but keep content
    .replace(/<(annotation|date|lang|src-lang|keywords|sequence|author)[^>]*>/gi, "")
    .replace(/<\/(annotation|date|lang|src-lang|keywords|sequence|author)>/gi, "");

  return html.trim();
}

/**
 * Extract a section title from FB2 inner HTML (looks for <title> or <h2>).
 */
function extractSectionTitle(inner: string): string {
  const titleMatch = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return htmlToPlainText(titleMatch[1]).trim();
  }
  return "";
}
