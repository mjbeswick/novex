import type { ParsedContent, Page, Word, Theme } from "./types";

// ── ANSI helpers ───────────────────────────────────────────────────────────────

const ANSI_RESET      = "\x1b[0m";
const ANSI_BOLD_ON    = "\x1b[1m";
const ANSI_BOLD_OFF   = "\x1b[22m";
const ANSI_ITALIC_ON  = "\x1b[3m";
const ANSI_ITALIC_OFF = "\x1b[23m";
const ANSI_DIM        = "\x1b[2m";
const ANSI_UNDERLINE  = "\x1b[4m";

interface ContentStyle {
  h1Text:  string;   // colour for h1 title text
  h1Bar:   string;   // colour for h1 separator bars  (═)
  h2Text:  string;   // colour for h2 title text
  h2Bar:   string;   // colour for h2 separator line  (─)
  h3Text:  string;   // colour for h3 title text
  hrBar:   string;   // colour for <hr> lines
  quote:   string;   // colour for blockquote text / gutter
  code:    string;   // colour for code blocks
  bold:    string;   // inline bold colour
  link:    string;   // link colour
}

function contentStyle(theme: Theme): ContentStyle {
  if (theme === "dark") {
    return {
      h1Text:  "\x1b[1;96m",   // bold bright-cyan
      h1Bar:   "\x1b[36m",     // cyan
      h2Text:  "\x1b[1;94m",   // bold bright-blue
      h2Bar:   "\x1b[34m",     // blue
      h3Text:  "\x1b[1;37m",   // bold white
      hrBar:   "\x1b[90m",     // dark-grey
      quote:   "\x1b[3;90m",   // italic dark-grey
      code:    "\x1b[90m",     // dark-grey
      bold:    "\x1b[1;97m",   // bold bright-white
      link:    "\x1b[4;94m",   // underline bright-blue
    };
  } else {
    return {
      h1Text:  "\x1b[1;34m",   // bold blue
      h1Bar:   "\x1b[34m",     // blue
      h2Text:  "\x1b[1;32m",   // bold green
      h2Bar:   "\x1b[32m",     // green
      h3Text:  "\x1b[1m",      // bold
      hrBar:   "\x1b[90m",     // grey
      quote:   "\x1b[3;90m",   // italic grey
      code:    "\x1b[90m",     // grey
      bold:    "\x1b[1m",      // bold
      link:    "\x1b[4;34m",   // underline blue
    };
  }
}

/**
 * Splits an array of wrapped lines into pages that fit within pageHeight.
 */
export function paginateText(lines: string[], pageHeight: number, firstPageHeight?: number): string[][] {
  if (pageHeight <= 0) return [lines];

  const pages: string[][] = [];
  let current: string[] = [];
  const firstLimit = firstPageHeight ?? pageHeight;

  for (const line of lines) {
    current.push(line);
    const limit = pages.length === 0 ? firstLimit : pageHeight;
    if (current.length >= limit) {
      pages.push(current);
      current = [];
    }
  }

  // Push any remaining lines as the last page
  if (current.length > 0) {
    pages.push(current);
  }

  // Return at least one empty page if input was empty
  if (pages.length === 0) {
    pages.push([]);
  }

  return pages;
}

/**
 * Word-wraps plain text to fit within `width` columns.
 * Preserves paragraph breaks (blank lines) as blank lines in output.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) width = 80;

  const outputLines: string[] = [];
  // Split on blank lines to find paragraphs
  const paragraphs = text.split(/\n{2,}/);

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const paragraph = paragraphs[pIdx];

    // Within a paragraph, collapse internal newlines to spaces
    const words = paragraph.replace(/\n/g, " ").split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      // Empty paragraph → blank line
      outputLines.push("");
      continue;
    }

    let currentLine = "";

    for (const word of words) {
      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= width) {
        currentLine += " " + word;
      } else {
        outputLines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine.length > 0) {
      outputLines.push(currentLine);
    }

    // Add blank line between paragraphs (but not after the last one)
    if (pIdx < paragraphs.length - 1) {
      outputLines.push("");
    }
  }

  return outputLines;
}

/**
 * Strips ANSI escape sequences to get the visible length of a string.
 */
function visibleLength(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Converts HTML to terminal-renderable lines with rich formatting:
 *
 *  <h1>           bold coloured title + ═══ bars
 *  <h2>           bold coloured title + ─── underline
 *  <h3>           bold "▸ title"
 *  <hr>           dim ────────────────
 *  <blockquote>   dim italic with │ gutter
 *  <pre><code>    dim with ┌─┐ / └─┘ box
 *  <code>         inline dim backtick wrapper
 *  <b>/<strong>   bold coloured
 *  <i>/<em>       italic
 *  <a>            underline blue
 *  <p> / <br>     paragraph / line breaks
 *  <li>           • bullets, ◦ sub-bullets
 *
 * `theme` controls colour palette (defaults to "dark").
 */
export function wrapHtml(html: string, width: number, theme: Theme = "dark"): string[] {
  if (width <= 0) width = 80;

  const cs = contentStyle(theme);
  const bar1  = cs.h1Bar  + "═".repeat(width) + ANSI_RESET; // h1 bar
  const bar2w = Math.min(width, 40);                          // h2 underline max width

  let processed = html;

  // ── Structural pre-processing ────────────────────────────────────────────────

  // <hr> → marker
  processed = processed.replace(/<hr\s*\/?>/gi, "\x00HR\x00");

  // <pre><code>…</code></pre> → box-framed code block
  processed = processed.replace(
    /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, src) => {
      const raw = src.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const codeLines = raw.split(/\n/);
      const inner = codeLines.map((l: string) => {
        const trimmed = l.replace(/\r$/, "");
        const padded = trimmed.length < width - 4 ? trimmed + " ".repeat(width - 4 - trimmed.length) : trimmed.slice(0, width - 4);
        return `\x00CODELINE\x00${cs.code}│ ${padded} │${ANSI_RESET}`;
      }).join("\n");
      const top = `${cs.code}┌${"─".repeat(width - 2)}┐${ANSI_RESET}`;
      const bot = `${cs.code}└${"─".repeat(width - 2)}┘${ANSI_RESET}`;
      return `\n\x00CODELINE\x00${top}\n${inner}\n\x00CODELINE\x00${bot}\n`;
    }
  );

  // <pre>…</pre> (without code) → same box treatment
  processed = processed.replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, src) => {
      const raw = src.replace(/<[^>]+>/g, "");
      const codeLines = raw.split(/\n/);
      const inner = codeLines.map((l: string) => {
        const trimmed = l.replace(/\r$/, "");
        const padded = trimmed.length < width - 4 ? trimmed + " ".repeat(width - 4 - trimmed.length) : trimmed.slice(0, width - 4);
        return `\x00CODELINE\x00${cs.code}│ ${padded} │${ANSI_RESET}`;
      }).join("\n");
      const top = `${cs.code}┌${"─".repeat(width - 2)}┐${ANSI_RESET}`;
      const bot = `${cs.code}└${"─".repeat(width - 2)}┘${ANSI_RESET}`;
      return `\n\x00CODELINE\x00${top}\n${inner}\n\x00CODELINE\x00${bot}\n`;
    }
  );

  // <h1> → bar + bold coloured title + bar
  processed = processed.replace(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
    (_, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      return `\n\n${bar1}\n${cs.h1Text}  ${text}${ANSI_RESET}\n${bar1}\n\n`;
    }
  );

  // <h2> → bold coloured + ─── underline
  processed = processed.replace(
    /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi,
    (_, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const underLen = Math.min(visibleLength(text) + 2, bar2w);
      const under = cs.h2Bar + "─".repeat(underLen) + ANSI_RESET;
      return `\n\n${cs.h2Text}  ${text}${ANSI_RESET}\n  ${under}\n\n`;
    }
  );

  // <h3>–<h6> → bold "▸ title"
  processed = processed.replace(
    /<h([3-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, _level, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      return `\n\n${cs.h3Text}  ▸ ${text}${ANSI_RESET}\n\n`;
    }
  );

  // <blockquote> → │ gutter with dim italic
  processed = processed.replace(
    /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const lines = text.split(/\n/).map((l: string) => `\x00QUOTELINE\x00${cs.quote}│ ${l.trim()}${ANSI_RESET}`);
      return `\n${lines.join("\n")}\n`;
    }
  );

  // ── Inline formatting ────────────────────────────────────────────────────────

  // <a href="…"> → underline blue (keep link text, drop href)
  processed = processed.replace(
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi,
    (_, txt) => `${cs.link}${txt}${ANSI_RESET}`
  );

  // Inline <code> → dim with backtick-style
  processed = processed.replace(
    /<code\b[^>]*>([\s\S]*?)<\/code>/gi,
    (_, src) => `${cs.code}\`${src.replace(/<[^>]+>/g, "")}\`${ANSI_RESET}`
  );

  // <b>/<strong>
  processed = processed.replace(
    /<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi,
    (_, content) => `${cs.bold}${ANSI_BOLD_ON}${content}${ANSI_BOLD_OFF}${ANSI_RESET}`
  );

  // <i>/<em>
  processed = processed.replace(
    /<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi,
    (_, content) => `${ANSI_ITALIC_ON}${content}${ANSI_ITALIC_OFF}`
  );

  // <u>
  processed = processed.replace(
    /<u\b[^>]*>([\s\S]*?)<\/u>/gi,
    (_, content) => `${ANSI_UNDERLINE}${content}${ANSI_RESET}`
  );

  // ── Block structure markers ──────────────────────────────────────────────────

  processed = processed.replace(/<p\b[^>]*>/gi,  "\x00P\x00");
  processed = processed.replace(/<\/p>/gi,        "\x00/P\x00");
  processed = processed.replace(/<br\s*\/?>/gi,   "\x00BR\x00");
  processed = processed.replace(/<li\b[^>]*>/gi,  "\x00LI\x00");
  processed = processed.replace(/<\/li>/gi,        "\x00/LI\x00");
  processed = processed.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, "\x00BLOCK\x00");

  // Strip remaining tags
  processed = processed.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  processed = processed
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g,    (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // ── Line assembly ─────────────────────────────────────────────────────────────

  const outputLines: string[] = [];

  for (const rawLine of processed.split(/\n/)) {
    // Pre-rendered lines (code boxes, blockquote gutters, HR, headings)
    if (rawLine.startsWith("\x00CODELINE\x00")) {
      outputLines.push(rawLine.slice("\x00CODELINE\x00".length));
      continue;
    }
    if (rawLine.startsWith("\x00QUOTELINE\x00")) {
      outputLines.push(rawLine.slice("\x00QUOTELINE\x00".length));
      continue;
    }
    if (rawLine === "\x00HR\x00") {
      outputLines.push("", cs.hrBar + "─".repeat(width) + ANSI_RESET, "");
      continue;
    }

    const parts = rawLine.split(
      /(\x00(?:P|\/P|BR|LI|\/LI|BLOCK)\x00)/
    );

    let seg = "";

    const flush = () => {
      if (seg.trim().length === 0) { seg = ""; return; }
      outputLines.push(...wrapSegment(seg.trim(), width));
      seg = "";
    };

    for (const part of parts) {
      switch (part) {
        case "\x00P\x00":    flush(); outputLines.push(""); break;
        case "\x00/P\x00":   flush(); outputLines.push(""); break;
        case "\x00BR\x00":   flush(); break;
        case "\x00LI\x00":   flush(); seg = "  • "; break;
        case "\x00/LI\x00":  flush(); break;
        case "\x00BLOCK\x00": flush(); outputLines.push(""); break;
        default:             seg += part;
      }
    }
    if (seg.trim()) { outputLines.push(...wrapSegment(seg.trim(), width)); }
  }

  // Collapse runs of blank lines
  const deduped: string[] = [];
  let prevBlank = false;
  for (const line of outputLines) {
    const blank = visibleLength(line) === 0;
    if (blank && prevBlank) continue;
    deduped.push(line);
    prevBlank = blank;
  }

  // Trim leading/trailing blanks
  let s = 0, e = deduped.length - 1;
  while (s <= e && visibleLength(deduped[s]) === 0) s++;
  while (e >= s && visibleLength(deduped[e]) === 0) e--;
  return deduped.slice(s, e + 1);
}

/**
 * Wraps a single segment of text (which may contain ANSI codes) to fit within width.
 * ANSI codes are counted as zero-width for wrapping purposes.
 */
function wrapSegment(text: string, width: number): string[] {
  if (width <= 0) width = 80;

  // Split into "word tokens" — we need to handle ANSI codes embedded in words
  // Simple approach: split on whitespace, treat each token as a unit
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";
  let currentVisible = 0;

  for (const token of tokens) {
    const tokenVisible = visibleLength(token);

    if (currentLine.length === 0) {
      currentLine = token;
      currentVisible = tokenVisible;
    } else if (currentVisible + 1 + tokenVisible <= width) {
      currentLine += " " + token;
      currentVisible += 1 + tokenVisible;
    } else {
      lines.push(currentLine);
      currentLine = token;
      currentVisible = tokenVisible;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [];
}

/**
 * Builds the full Page[] array from ParsedContent.
 * Uses wrapHtml on each chapter's html, then paginateText into pages.
 */
export function buildPages(
  content: ParsedContent,
  cols: number,
  rows: number,
  lineWidth?: number,
  theme: Theme = "dark",
  coverImageRows: number = 0
): Page[] {
  const effectiveWidth = Math.min(lineWidth ?? 80, cols);
  // Reserve rows for header + separator + status + hints
  const pageHeight = Math.max(1, rows - 4);

  const pages: Page[] = [];
  let globalPageIndex = 0;

  for (const chapter of content.chapters) {
    const lines = wrapHtml(chapter.html, effectiveWidth, theme);
    // If this is the first chapter and we have a cover image, shorten the first page
    const firstPageHeight = (globalPageIndex === 0 && coverImageRows > 0)
      ? Math.max(1, pageHeight - coverImageRows)
      : undefined;
    const chapterPages = paginateText(lines, pageHeight, firstPageHeight);

    for (let pageIndexInChapter = 0; pageIndexInChapter < chapterPages.length; pageIndexInChapter++) {
      pages.push({
        lines: chapterPages[pageIndexInChapter],
        chapterIndex: chapter.index,
        pageIndexInChapter,
        globalPageIndex,
      });
      globalPageIndex++;
    }
  }

  // Ensure at least one page exists
  if (pages.length === 0) {
    pages.push({
      lines: [],
      chapterIndex: 0,
      pageIndexInChapter: 0,
      globalPageIndex: 0,
    });
  }

  return pages;
}

/**
 * Groups words into chunks for the speed reader.
 */
export function chunkWords(words: Word[], chunkSize: number): Word[][] {
  if (chunkSize <= 0) chunkSize = 1;

  const chunks: Word[][] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize));
  }

  return chunks;
}
