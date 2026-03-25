import type { Word } from "./types";

/**
 * Cleans up HTML: removes scripts/styles, normalizes whitespace,
 * wraps bare text nodes in <p>, collapses multiple <br> into paragraph breaks.
 */
export function normalizeHtml(html: string): string {
  let result = html;

  // Remove script tags and their contents
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove style tags and their contents
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  // Remove head section entirely
  result = result.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");

  // Collapse multiple consecutive <br> tags (2+) into a paragraph break
  result = result.replace(/(<br\s*\/?>\s*){2,}/gi, "</p><p>");

  // Normalize single <br> tags to a consistent form
  result = result.replace(/<br\s*\/?>/gi, "<br>");

  // Strip xml/doctype declarations
  result = result.replace(/<\?xml[^>]*\?>/gi, "");
  result = result.replace(/<!DOCTYPE[^>]*>/gi, "");

  // Normalize whitespace within text content (collapse runs of spaces/tabs)
  // but preserve newlines between block elements
  result = result.replace(/[ \t]+/g, " ");

  // Remove whitespace between block-level tags
  result = result.replace(/>\s+</g, (match) => {
    // Preserve a single space only if it's between inline elements
    return "> <".includes(match) ? "> <" : "><";
  });
  result = result.replace(/>\s{2,}</g, "> ");
  result = result.replace(/\s{2,}</g, " <");

  // Wrap bare text that appears outside of block elements
  // Find text runs not inside any tag (simple heuristic: after > ... before <)
  result = result.replace(/>([^<]+)</g, (match, text) => {
    const trimmed = text.trim();
    if (!trimmed) return "><";
    // If it looks like meaningful content not already wrapped, wrap it
    return `>${trimmed}<`;
  });

  // Ensure the document has a root wrapper
  const hasBlockWrapper =
    /<(div|article|section|main|body)\b/i.test(result);
  if (!hasBlockWrapper) {
    result = `<div>${result}</div>`;
  }

  return result.trim();
}

/**
 * Splits plain text into Word[] with index and charOffset fields.
 * A "word" is any non-whitespace token (handles punctuation as part of the token).
 */
export function extractWords(text: string): Word[] {
  const words: Word[] = [];
  // Match any sequence of non-whitespace characters
  const tokenRegex = /\S+/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    words.push({
      text: match[0],
      index,
      charOffset: match.index,
    });
    index++;
  }

  return words;
}

/**
 * Extracts document title from first <h1> and splits at heading boundaries.
 */
export function extractStructure(
  html: string
): { title: string; sections: string[] } {
  // Extract title from first <h1>
  let title = "";
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    // Strip any tags inside the heading
    title = h1Match[1].replace(/<[^>]+>/g, "").trim();
  }

  // If no h1, try <title> tag
  if (!title) {
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    }
  }

  // Split at heading boundaries (h1, h2, h3, h4, h5, h6)
  // We split the content at each heading tag so each heading starts a new section
  const headingRegex = /(?=<h[1-6]\b[^>]*>)/i;
  const rawSections = html.split(headingRegex);

  const sections: string[] = [];
  for (const section of rawSections) {
    const trimmed = section.trim();
    if (trimmed.length > 0) {
      sections.push(trimmed);
    }
  }

  // If no headings found, treat the whole document as one section
  if (sections.length === 0 && html.trim().length > 0) {
    sections.push(html.trim());
  }

  return { title, sections };
}
