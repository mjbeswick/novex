import type { ContentFormat, ParsedContent } from "../types.ts";
import path from "path";

import { convertEpub } from "./epub.ts";
import { convertDocx } from "./docx.ts";
import { convertFb2 } from "./fb2.ts";
import { convertMarkdown } from "./markdown.ts";
import { convertText } from "./text.ts";
import { htmlToPlainText } from "./utils.ts";

// ---------------------------------------------------------------------------
// Magic-byte signatures
// ---------------------------------------------------------------------------

/**
 * Detect content format from magic bytes first, falling back to file extension.
 *
 * Magic bytes checked:
 *  - EPUB / DOCX / ZIP:  PK\x03\x04  (0x50 0x4B 0x03 0x04) — disambiguated by extension
 *  - FB2 XML:            starts with `<?xml` or `<FictionBook`
 *
 * Extension fallback covers: .epub, .docx, .fb2, .md / .markdown, .txt, .html / .htm
 */
export function detectFormat(filePath: string, buffer: Uint8Array): ContentFormat {
  // --- Magic byte detection ---

  // ZIP-based formats (EPUB, DOCX)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".docx") return "docx";
    // Default ZIP-like to epub (EPUB is the primary supported ZIP format)
    return "epub";
  }

  // XML / FB2 detection — check for XML declaration or root element
  if (buffer.length >= 5) {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(
      buffer.subarray(0, Math.min(512, buffer.length))
    );
    const trimmed = head.trimStart();
    if (
      trimmed.startsWith("<?xml") ||
      trimmed.startsWith("<FictionBook") ||
      trimmed.startsWith("<fictionbook")
    ) {
      return "fb2";
    }

    // HTML magic
    if (
      trimmed.startsWith("<!DOCTYPE html") ||
      trimmed.startsWith("<!doctype html") ||
      trimmed.startsWith("<html")
    ) {
      return "html";
    }
  }

  // --- Extension fallback ---
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".epub":
      return "epub";
    case ".docx":
      return "docx";
    case ".fb2":
      return "fb2";
    case ".md":
    case ".markdown":
    case ".mdown":
      return "markdown";
    case ".html":
    case ".htm":
      return "html";
    case ".txt":
    default:
      return "text";
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Convert the file at `filePath` (already read into `buffer`) to a ParsedContent
 * structure, using the provided pre-detected `format`.
 *
 * The `hash` parameter should be a SHA-256 hex digest of the source buffer,
 * computed by the caller.
 */
export async function convertToContent(
  filePath: string,
  buffer: Uint8Array,
  format: ContentFormat
): Promise<ParsedContent> {
  // Compute a SHA-256 hash of the buffer for state keying
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const source = filePath;

  switch (format) {
    case "epub":
      return convertEpub(buffer, source, hash);

    case "docx":
      return convertDocx(buffer, source, hash);

    case "fb2":
      return convertFb2(buffer, source, hash);

    case "markdown": {
      const text = new TextDecoder("utf-8").decode(buffer);
      return convertMarkdown(text, source, hash);
    }

    case "html": {
      // Treat HTML as Markdown-like: pass the raw HTML through the markdown
      // converter so headings are still respected for chapter splitting.
      // Actually, for HTML we just use it directly as the full HTML.
      const text = new TextDecoder("utf-8").decode(buffer);
      return convertHtml(text, source, hash);
    }

    case "text":
    default: {
      const text = new TextDecoder("utf-8").decode(buffer);
      return convertText(text, source, hash);
    }
  }
}

// ---------------------------------------------------------------------------
// Inline HTML handler (not a full format — just used by the dispatcher)
// ---------------------------------------------------------------------------

function convertHtml(
  html: string,
  source: string,
  hash: string
): ParsedContent {
  const fileBasename =
    source !== "stdin" ? path.basename(source, path.extname(source)) : "stdin";

  // Try to pull title from <title> tag
  let docTitle = fileBasename;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const t = htmlToPlainText(titleMatch[1]).trim();
    if (t) docTitle = t;
  }

  // Extract body content if present
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;

  const text = htmlToPlainText(bodyHtml);

  return {
    html: bodyHtml,
    text,
    title: docTitle,
    source,
    hash,
    chapters: [
      {
        title: docTitle,
        html: bodyHtml,
        text,
        index: 0,
      },
    ],
  };
}
