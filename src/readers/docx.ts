import type { ParsedContent, Chapter } from "../types.ts";
import mammoth from "mammoth";
import { htmlToPlainText, extractImages } from "./utils.ts";
import path from "path";

/**
 * Convert a DOCX buffer into a ParsedContent structure.
 * Uses mammoth to produce HTML, then splits at <h1> boundaries.
 */
export async function convertDocx(
  buffer: Uint8Array,
  source: string,
  hash: string
): Promise<ParsedContent> {
  const fileBasename =
    source !== "stdin" ? path.basename(source, path.extname(source)) : "stdin";

  // mammoth expects a Node.js Buffer or an object with an arrayBuffer property
  const nodeBuffer = Buffer.from(buffer);
  const result = await mammoth.convertToHtml({ buffer: nodeBuffer });

  const fullHtml = result.value;

  const chapters = splitAtH1(fullHtml, fileBasename);

  // Try to use the first chapter's heading as the document title
  const title =
    chapters.length > 0 && chapters[0].title !== fileBasename
      ? chapters[0].title
      : fileBasename;

  const plainText = htmlToPlainText(fullHtml);

  // Extract images from content
  const images = extractImages(fullHtml);

  return {
    html: fullHtml,
    text: plainText,
    title,
    source,
    hash,
    chapters,
    images: images.size > 0 ? images : undefined,
  };
}

/**
 * Split an HTML string into chapters at <h1> boundaries.
 */
function splitAtH1(html: string, fallbackTitle: string): Chapter[] {
  const h1Regex = /(<h1[^>]*>[\s\S]*?<\/h1>)/gi;
  const parts = html.split(h1Regex);

  const chapters: Chapter[] = [];
  let chapterIndex = 0;

  // Preamble content before first h1
  const preamble = parts[0]?.trim();
  if (preamble) {
    chapters.push({
      title: fallbackTitle,
      html: preamble,
      text: htmlToPlainText(preamble),
      index: chapterIndex++,
    });
  }

  // Each h1 + following content
  for (let i = 1; i < parts.length; i += 2) {
    const h1Tag = parts[i] ?? "";
    const content = parts[i + 1] ?? "";
    const headingText = htmlToPlainText(h1Tag).trim();
    const chapterHtml = h1Tag + content;

    chapters.push({
      title: headingText || fallbackTitle,
      html: chapterHtml,
      text: htmlToPlainText(chapterHtml),
      index: chapterIndex++,
    });
  }

  if (chapters.length === 0) {
    chapters.push({
      title: fallbackTitle,
      html,
      text: htmlToPlainText(html),
      index: 0,
    });
  }

  return chapters;
}
