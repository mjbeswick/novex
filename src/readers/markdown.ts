import type { ParsedContent, Chapter } from "../types.ts";
import { marked } from "marked";
import { htmlToPlainText } from "./utils.ts";
import path from "path";

/**
 * Convert Markdown text into a ParsedContent structure.
 * Chapters are split at <h1> boundaries.
 */
export async function convertMarkdown(
  text: string,
  source: string,
  hash: string
): Promise<ParsedContent> {
  const fileBasename =
    source !== "stdin" ? path.basename(source, path.extname(source)) : "stdin";

  // Convert the full markdown to HTML
  const fullHtml = await marked(text);

  // Split into chapters at <h1> boundaries
  const chapters = splitAtH1(fullHtml, fileBasename);

  // Derive the document title from the first h1 if available
  const title =
    chapters.length > 0 && chapters[0].title !== fileBasename
      ? chapters[0].title
      : fileBasename;

  const plainText = htmlToPlainText(fullHtml);

  return {
    html: fullHtml,
    text: plainText,
    title,
    source,
    hash,
    chapters,
  };
}

/**
 * Split an HTML string into chapters at every <h1> tag.
 * Content before the first <h1> is grouped into a preamble chapter using the fallback title.
 */
function splitAtH1(html: string, fallbackTitle: string): Chapter[] {
  // Match <h1 ...>...</h1> (case-insensitive, allowing attributes)
  const h1Regex = /(<h1[^>]*>[\s\S]*?<\/h1>)/gi;

  const parts = html.split(h1Regex);
  // parts alternates: [before_first_h1, h1_tag, content, h1_tag, content, ...]

  const chapters: Chapter[] = [];
  let chapterIndex = 0;

  // Content before the first h1 (if any)
  const preamble = parts[0]?.trim();
  if (preamble) {
    const preambleHtml = preamble;
    chapters.push({
      title: fallbackTitle,
      html: preambleHtml,
      text: htmlToPlainText(preambleHtml),
      index: chapterIndex++,
    });
  }

  // Process each h1 + following content pair
  for (let i = 1; i < parts.length; i += 2) {
    const h1Tag = parts[i] ?? "";
    const content = parts[i + 1] ?? "";

    // Extract the heading text
    const headingText = htmlToPlainText(h1Tag).trim();
    const chapterHtml = h1Tag + content;

    chapters.push({
      title: headingText || fallbackTitle,
      html: chapterHtml,
      text: htmlToPlainText(chapterHtml),
      index: chapterIndex++,
    });
  }

  // If no chapters were created at all, wrap everything as one chapter
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
