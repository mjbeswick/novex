import type { ParsedContent, Chapter } from "../types.ts";
import mammoth from "mammoth";
import { htmlToPlainText, extractImages } from "./utils.ts";
import path from "path";

interface HeadingInfo {
  level: number;
  title: string;
  html: string;
  position: number;
}

/**
 * Convert a DOCX buffer into a ParsedContent structure.
 * Uses mammoth to produce HTML, then extracts hierarchical heading structure.
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

  const chapters = buildHierarchicalChapters(fullHtml, fileBasename);

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
 * Extract all headings (h1-h6) from HTML with their levels and positions.
 */
function extractHeadings(html: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];

  // Find all h1-h6 tags
  for (let level = 1; level <= 6; level++) {
    const tagName = `h${level}`;
    const openRegex = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "gi");
    const closeRegex = new RegExp(`</${tagName}>`, "i");

    let openMatch: RegExpExecArray | null;
    while ((openMatch = openRegex.exec(html)) !== null) {
      const openPos = openMatch.index;
      const closeMatch = closeRegex.exec(html.substring(openPos));

      if (closeMatch) {
        const closePos = openPos + closeMatch.index + closeMatch[0].length;
        const fullTag = html.substring(openPos, closePos);
        const title = htmlToPlainText(fullTag).trim();

        headings.push({
          level,
          title,
          html: fullTag,
          position: openPos,
        });

        // Move regex position past this closing tag
        openRegex.lastIndex = closePos;
      }
    }
  }

  // Sort by position in document
  headings.sort((a, b) => a.position - b.position);

  return headings;
}

/**
 * Build hierarchical chapter structure from heading list.
 * Creates a flat chapter array with parent/child pointers.
 */
function buildHierarchicalChapters(
  html: string,
  fallbackTitle: string
): Chapter[] {
  const headings = extractHeadings(html);

  if (headings.length === 0) {
    // No headings, wrap everything as one chapter
    return [
      {
        title: fallbackTitle,
        html,
        text: htmlToPlainText(html),
        index: 0,
      },
    ];
  }

  const chapters: Chapter[] = [];
  let chapterIndex = 0;

  // Add preamble if there's content before first heading
  const firstHeadingPos = headings[0]?.position ?? 0;
  const preamble = firstHeadingPos > 0 ? html.substring(0, firstHeadingPos).trim() : "";

  if (preamble) {
    chapters.push({
      title: fallbackTitle,
      html: preamble,
      text: htmlToPlainText(preamble),
      index: chapterIndex++,
      level: 1,
      children: [],
    });
  }

  // Track hierarchy: stack of parent indices by level
  const parentStack: number[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];

    // Extract content between this heading and the next
    const contentStart = heading.position + heading.html.length;
    const contentEnd = nextHeading ? nextHeading.position : html.length;
    const headingContent = html.substring(contentStart, contentEnd);

    const chapterHtml = heading.html + headingContent;

    // Find parent: remove parents from stack that are >= current level
    while (parentStack.length > 0 && parentStack.length >= heading.level) {
      parentStack.pop();
    }

    const parentIndex = parentStack.length > 0 ? parentStack[parentStack.length - 1] : undefined;

    const chapter: Chapter = {
      title: heading.title || fallbackTitle,
      html: chapterHtml,
      text: htmlToPlainText(chapterHtml),
      index: chapterIndex,
      level: heading.level,
      parentIndex,
      children: [],
    };

    // Add to parent's children list if it has a parent
    if (parentIndex !== undefined && chapters[parentIndex]) {
      if (!chapters[parentIndex].children) {
        chapters[parentIndex].children = [];
      }
      chapters[parentIndex].children!.push(chapterIndex);
    }

    chapters.push(chapter);
    parentStack.push(chapterIndex);
    chapterIndex++;
  }

  return chapters;
}
