import type { ParsedContent } from "../types.ts";
import { htmlToPlainText } from "./utils.ts";
import path from "path";

/**
 * Convert plain text content into a ParsedContent structure.
 * The entire content is treated as a single chapter wrapped in a <pre> block.
 */
export function convertText(
  text: string,
  source: string,
  hash: string
): ParsedContent {
  const title = source !== "stdin" ? path.basename(source) : "stdin";

  // Escape HTML special characters inside the pre block
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<pre>${escaped}</pre>`;
  const plainText = htmlToPlainText(html);

  return {
    html,
    text: plainText,
    title,
    source,
    hash,
    chapters: [
      {
        title,
        html,
        text: plainText,
        index: 0,
      },
    ],
  };
}
