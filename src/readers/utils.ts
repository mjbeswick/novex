/**
 * Shared utilities for format readers.
 */

/**
 * Strip all HTML tags from a string, decoding common entities and collapsing whitespace.
 */
export function htmlToPlainText(html: string): string {
  // Replace block-level tags with newlines to preserve paragraph breaks
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/blockquote>/gi, "\n\n")
    .replace(/<\/pre>/gi, "\n\n");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

  // Collapse excessive blank lines (more than 2 consecutive newlines)
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
