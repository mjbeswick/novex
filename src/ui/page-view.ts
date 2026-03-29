import type { Page, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo } from "./terminal";
import { themes } from "./themes";
import type { ColorTheme } from "./themes";

export interface PageSelection {
  pageIndex: number;          // which page the selection lives on
  paraStart: number;
  paraEnd: number;
  wordLine: number | null;    // absolute line index on page
  wordColStart: number | null;
  wordColEnd: number | null;
  wordText: string | null;
  wordIndex: number | null;   // index in allWords array
  chapterIndex?: number;      // chapter index
  paraIndexInChapter?: number; // paragraph index within the chapter
}

export interface PageViewState {
  pages: Page[];
  currentPage: number;
  theme: Theme;
  lineWidth?: number;
  bookmarkCount: number;
  chapterTitle: string;
  title: string;
  selection: PageSelection | null;
  /** 0-based line indices within the current (left) page that have a bookmark marker. */
  bookmarkedLines: number[];
  /** 0-based line indices within the right page (spread mode only) that have a bookmark marker. */
  bookmarkedLinesRight: number[];
  /** Whether the current page or selected word is bookmarked. */
  isBookmarked: boolean;
  /** Pre-rendered terminal escape sequence for cover image (shown on page 0). */
  coverImageEscape?: string;
  /** Map of image IDs to image paths. */
  images?: Map<string, string>;
}

/** Minimum terminal width to activate two-page spread layout. */
export const SPREAD_MIN_COLS = 120;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Pad or truncate a raw string (no embedded ANSI) to exactly `width` chars. */
function padEnd(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

/** Strip ANSI sequences for visible-length calculations. */
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Detect if a line contains image placeholders. */
function hasImage(line: string): boolean {
  return /\[Image \d+\]/.test(line);
}

/** Style image placeholders in a line. */
function styleImages(line: string, t: ColorTheme): string {
  return line.replace(/\[Image (\d+)\]/g, `${t.accent}${ANSI.bold}[Image $1]${ANSI.reset}${t.text}`);
}

/**
 * Fit a string (possibly containing ANSI codes) into exactly `width` visible
 * columns: truncate long lines (preserving escape sequences) and pad short
 * ones. Always appends a reset so the caller's next colour is not polluted.
 */
function fitAnsi(str: string, width: number): string {
  let visible = 0;
  let result = "";
  let i = 0;

  while (i < str.length) {
    // Consume an ANSI CSI escape sequence without counting it as visible
    if (str.charCodeAt(i) === 0x1b && str[i + 1] === "[") {
      const end = str.indexOf("m", i + 2);
      if (end !== -1) {
        if (visible < width) result += str.slice(i, end + 1); // keep if still within
        i = end + 1;
        continue;
      }
    }
    if (visible < width) {
      result += str[i];
      visible++;
    }
    i++;
  }

  if (visible < width) result += " ".repeat(width - visible);
  return result + ANSI.reset;
}

/**
 * Insert bold+underline at colStart and reset+resume at colEnd+1 in
 * visible-char terms (ANSI-aware).
 */
function highlightWord(line: string, colStart: number, colEnd: number): string {
  let visible = 0;
  let result = "";
  let i = 0;
  let opened = false;
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b && line[i + 1] === "[") {
      const end = line.indexOf("m", i + 2);
      if (end !== -1) { result += line.slice(i, end + 1); i = end + 1; continue; }
    }
    if (!opened && visible === colStart) { result += "\x1b[1m\x1b[4m"; opened = true; }
    if (opened && visible === colEnd + 1) { result += "\x1b[22m\x1b[24m"; opened = false; }
    result += line[i]; visible++; i++;
  }
  if (opened) result += ANSI.reset;
  return result;
}

/**
 * Style hint strings: remove brackets, colour the key in accent+bold, action
 * text stays dim. Single alpha keys are inlined into the following word
 * (e.g. "[n]ext" → "next" with n highlighted); symbol/multi-char keys get a
 * space separator (e.g. "[c]lear" → "esc clear").
 */
function formatHints(text: string, t: ColorTheme): string {
  return text.replace(/\[([^\]]+)\](\w*)/g, (_m, key: string, rest: string) => {
    const sep = (key.length === 1 && /[a-zA-Z]/.test(key)) ? "" : (rest ? " " : "");
    return `${ANSI.reset}${t.accent}${ANSI.bold}${key}${ANSI.reset}${t.dim}${sep}${rest}`;
  });
}

/**
 * Extract shortcuts and their positions from the raw hints text.
 * Returns array of {key, startCol, endCol} where columns are 1-indexed.
 */
function extractShortcutsFromHints(text: string): Array<{key: string; startCol: number; endCol: number}> {
  const shortcuts: Array<{key: string; startCol: number; endCol: number}> = [];
  let col = 1; // 1-indexed column position
  const re = /\[([^\]]+)\](\w*)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const rest = m[2] ?? "";
    const keyStartCol = col;
    const keyEndCol = keyStartCol + key.length - 1;

    shortcuts.push({
      key,
      startCol: keyStartCol,
      endCol: keyEndCol,
    });

    // Move column forward: key + optional separator + rest
    const sep = (key.length === 1 && /[a-zA-Z]/.test(key)) ? "" : (rest ? " " : "");
    col += key.length + sep.length + rest.length;
  }

  return shortcuts;
}

// ── PageView ───────────────────────────────────────────────────────────────────

export class PageView {
  private state: PageViewState;
  private lastHints: string = ""; // Cache last hints string for click detection

  constructor(state: PageViewState) {
    this.state = { ...state };
  }

  updateState(state: Partial<PageViewState>): void {
    this.state = { ...this.state, ...state };
  }

  /** Returns true when the current terminal is wide enough for spread layout. */
  isSpread(): boolean {
    return getTerminalSize().cols >= SPREAD_MIN_COLS;
  }

  /**
   * Check if a footer click matches a shortcut and return the key.
   * Row should be the footer row (bottom row), col should be 1-indexed.
   */
  getKeyFromFooterClick(row: number, col: number): string | null {
    const { rows } = getTerminalSize();
    if (row !== rows) return null; // Footer is at bottom row

    const shortcuts = extractShortcutsFromHints(this.lastHints);
    for (const shortcut of shortcuts) {
      if (col >= shortcut.startCol && col <= shortcut.endCol) {
        return shortcut.key;
      }
    }
    return null;
  }

  render(): void {
    const { cols, rows } = getTerminalSize();
    if (cols >= SPREAD_MIN_COLS) {
      this.renderSpread(cols, rows);
    } else {
      this.renderSingle(cols, rows);
    }
  }

  // ── Single-page layout ──────────────────────────────────────────────────────

  private renderSingle(cols: number, rows: number): void {
    const { pages, currentPage, theme, chapterTitle, title, selection } = this.state;
    const t = themes[theme];

    clearScreen();

    const totalPages = pages.length;
    const percent = totalPages > 1 ? Math.round((currentPage / (totalPages - 1)) * 100) : 100;
    const statusRight = `${percent}% · pg ${currentPage + 1}/${totalPages}`;
    // Left: "title · chapter", right-aligned: status
    const leftLabel = title !== chapterTitle
      ? `${title} · ${chapterTitle}`
      : title;
    const gap = cols - visLen(leftLabel) - visLen(statusRight);
    const headerLine = leftLabel + " ".repeat(Math.max(gap, 1)) + statusRight;

    moveTo(1, 1);
    process.stdout.write(
      t.accent + ANSI.bold +
      headerLine.slice(0, cols) +
      ANSI.reset
    );

    moveTo(2, 1);
    process.stdout.write(t.border + "─".repeat(cols) + ANSI.reset);

    const contentRows = rows - 4;
    const lines = pages[currentPage]?.lines ?? [];
    const { coverImageEscape } = this.state;
    const showCover = coverImageEscape && currentPage === 0;

    if (showCover) {
      // Center the image vertically and horizontally
      const vPad = Math.floor(contentRows / 2);
      const hPad = Math.floor(cols / 2);
      moveTo(3 + vPad, hPad + 1);
      process.stdout.write(coverImageEscape);
    } else {
      for (let i = 0; i < contentRows; i++) {
        moveTo(i + 3, 1);
        const inSel = selection && selection.pageIndex === currentPage &&
          i >= selection.paraStart && i <= selection.paraEnd;
        let lineStr = lines[i] ?? "";
        // Style image placeholders
        if (hasImage(lineStr)) {
          lineStr = styleImages(lineStr, t);
        }
        if (inSel &&
            selection!.wordLine === i &&
            selection!.wordColStart !== null &&
            selection!.wordColEnd !== null) {
          lineStr = highlightWord(lineStr, selection!.wordColStart, selection!.wordColEnd);
        }
        const selBg = inSel ? t.selectionBg : "";
        const displayLine = selBg
          ? lineStr.replace(/\x1b\[0m/g, `\x1b[0m${selBg}`)
          : lineStr;
        process.stdout.write(selBg + fitAnsi(t.text + displayLine, cols));
      }
      // Bookmark markers — overlay ◆ at the right edge of bookmarked lines
      for (const li of this.state.bookmarkedLines) {
        if (li >= 0 && li < contentRows) {
          moveTo(li + 3, cols);
          process.stdout.write(t.accent + "◆" + ANSI.reset);
        }
      }
    }

    // Footer separator + hints
    const bmLabel = this.state.isBookmarked ? "[b]ookmarked ◆" : "[b]ookmark";
    const currentPageLines = pages[currentPage]?.lines ?? [];
    const hasImages = this.state.images && this.state.images.size > 0 &&
      currentPageLines.some(line => hasImage(line));
    const imageHint = hasImages ? " [i]mage" : "";
    let hintsText: string;
    if (!selection) {
      hintsText = `[n]ext [p]rev ${bmLabel} [B]marks [s]peed [v]scroll [T]oc [/]search${imageHint} [q]uit [?]help`;
    } else if (selection.wordText) {
      const wordIdx = selection.wordIndex !== null ? ` [#${selection.wordIndex}]` : "";
      hintsText = `"${selection.wordText}"${wordIdx} · [s]peed ${bmLabel} [B]marks [t]ts [c]lear`;
    } else {
      let paraInfo = "";
      if (selection.chapterIndex !== undefined && selection.paraIndexInChapter !== undefined) {
        paraInfo = ` [ch ${selection.chapterIndex}, para ${selection.paraIndexInChapter + 1}]`;
      } else if (selection.pageIndex !== undefined) {
        paraInfo = ` [page ${selection.pageIndex + 1}]`;
      }
      hintsText = `Para selected${paraInfo} · [s]peed ${bmLabel} [B]marks [t]ts [c]lear`;
    }

    this.lastHints = hintsText; // Cache for click detection

    moveTo(rows - 1, 1);
    process.stdout.write(t.border + "─".repeat(cols) + ANSI.reset);
    moveTo(rows, 1);
    process.stdout.write(
      t.dim + formatHints(hintsText, t) + ANSI.reset
    );
  }

  // ── Two-page spread layout ──────────────────────────────────────────────────

  private renderSpread(cols: number, rows: number): void {
    const { pages, currentPage, theme, chapterTitle, title, selection } = this.state;
    const t = themes[theme];

    clearScreen();

    const totalPages = pages.length;
    const GUTTER = 3; // " │ "
    const colWidth = Math.floor((cols - GUTTER) / 2);

    const leftIdx  = currentPage;
    const rightIdx = currentPage + 1;
    const leftPage  = pages[leftIdx];
    const rightPage = pages[rightIdx];

    const leftLines  = leftPage?.lines  ?? [];
    const rightLines = rightPage?.lines ?? [];

    // ── Chapter titles for each page ─────────────────────────────────────────
    const leftTitle  = leftPage  ? (this.getChapterTitle(leftIdx)  ?? chapterTitle) : chapterTitle;
    const rightTitle = rightPage ? (this.getChapterTitle(rightIdx) ?? chapterTitle) : "";

    // ── Header row (with status integrated) ──────────────────────────────────
    const percent = totalPages > 1 ? Math.round((leftIdx / (totalPages - 1)) * 100) : 100;
    const statusRight = `${percent}% · pg ${leftIdx + 1}${rightPage ? `–${rightIdx + 1}` : ""}/${totalPages}`;

    // Left half header: "title · chapter"
    const leftLabel = title !== leftTitle ? `${title} · ${leftTitle}` : title;
    const leftHeader = t.accent + ANSI.bold + fitAnsi(leftLabel, colWidth) + ANSI.reset;

    // Right half header: chapter | status right-aligned
    const rightGap = colWidth - visLen(rightTitle) - visLen(statusRight);
    const rightHeaderText = rightTitle + " ".repeat(Math.max(rightGap, 1)) + statusRight;
    const rightHeader = rightPage
      ? t.accent + ANSI.bold + rightHeaderText.slice(0, colWidth) + ANSI.reset
      : " ".repeat(colWidth);

    moveTo(1, 1);
    process.stdout.write(leftHeader + " ".repeat(GUTTER) + rightHeader);

    // ── Top separator ─────────────────────────────────────────────────────────
    const gutterTop = "─".repeat(Math.floor(GUTTER / 2)) + "┬" + "─".repeat(GUTTER - Math.floor(GUTTER / 2) - 1);
    moveTo(2, 1);
    process.stdout.write(t.border + "─".repeat(colWidth) + gutterTop + "─".repeat(colWidth) + ANSI.reset);

    // ── Content rows ──────────────────────────────────────────────────────────
    const contentRows = rows - 4;
    const { coverImageEscape } = this.state;
    const showCover = coverImageEscape && leftIdx === 0;

    if (showCover) {
      // Cover fills the left page, centered
      const vPad = Math.floor(contentRows / 2);
      const hPad = Math.floor(colWidth / 2);
      moveTo(3 + vPad, hPad + 1);
      process.stdout.write(coverImageEscape);

      // Render gutter + right page normally
      for (let i = 0; i < contentRows; i++) {
        moveTo(i + 3, colWidth + 1);
        process.stdout.write(t.border + " │ " + ANSI.reset);

        const inRightSel = selection && selection.pageIndex === rightIdx &&
          i >= selection.paraStart && i <= selection.paraEnd;
        let rightLine = rightLines[i] ?? "";
        if (inRightSel &&
            selection!.wordLine === i &&
            selection!.wordColStart !== null &&
            selection!.wordColEnd !== null) {
          rightLine = highlightWord(rightLine, selection!.wordColStart, selection!.wordColEnd);
        }
        const rightBg = inRightSel ? t.selectionBg : "";
        const displayRight = rightBg ? rightLine.replace(/\x1b\[0m/g, `\x1b[0m${rightBg}`) : rightLine;
        process.stdout.write(fitAnsi(rightBg + t.text + displayRight, colWidth));
      }
      // Bookmark markers (right page only when cover is shown)
      for (const li of this.state.bookmarkedLinesRight) {
        if (li >= 0 && li < contentRows) {
          moveTo(li + 3, cols);
          process.stdout.write(t.accent + "◆" + ANSI.reset);
        }
      }
    } else {
      for (let i = 0; i < contentRows; i++) {
        moveTo(i + 3, 1);

        // Left side with selection highlight
        const inLeftSel = selection && selection.pageIndex === leftIdx &&
          i >= selection.paraStart && i <= selection.paraEnd;
        let leftLine = leftLines[i] ?? "";
        if (inLeftSel &&
            selection!.wordLine === i &&
            selection!.wordColStart !== null &&
            selection!.wordColEnd !== null) {
          leftLine = highlightWord(leftLine, selection!.wordColStart, selection!.wordColEnd);
        }

        const leftBg = inLeftSel ? t.selectionBg : "";
        const displayLeft = leftBg ? leftLine.replace(/\x1b\[0m/g, `\x1b[0m${leftBg}`) : leftLine;
        process.stdout.write(fitAnsi(leftBg + t.text + displayLeft, colWidth));

        // Gutter
        process.stdout.write(t.border + " │ " + ANSI.reset);

        // Right side with selection highlight
        const inRightSel = selection && selection.pageIndex === rightIdx &&
          i >= selection.paraStart && i <= selection.paraEnd;
        let rightLine = rightLines[i] ?? "";
        if (inRightSel &&
            selection!.wordLine === i &&
            selection!.wordColStart !== null &&
            selection!.wordColEnd !== null) {
          rightLine = highlightWord(rightLine, selection!.wordColStart, selection!.wordColEnd);
        }

        const rightBg = inRightSel ? t.selectionBg : "";
        const displayRight = rightBg ? rightLine.replace(/\x1b\[0m/g, `\x1b[0m${rightBg}`) : rightLine;
        process.stdout.write(fitAnsi(rightBg + t.text + displayRight, colWidth));
      }
      // Bookmark markers
      for (const li of this.state.bookmarkedLines) {
        if (li >= 0 && li < contentRows) {
          moveTo(li + 3, colWidth);
          process.stdout.write(t.accent + "◆" + ANSI.reset);
        }
      }
      for (const li of this.state.bookmarkedLinesRight) {
        if (li >= 0 && li < contentRows) {
          moveTo(li + 3, cols);
          process.stdout.write(t.accent + "◆" + ANSI.reset);
        }
      }
    }

    // ── Footer separator + key hints ──────────────────────────────────────────
    const bmLabel = this.state.isBookmarked ? "[b]ookmarked ◆" : "[b]ookmark";
    let hintsText: string;
    if (!selection) {
      hintsText = `[n]ext [p]rev ${bmLabel} [B]marks [s]peed [v]scroll [T]oc [/]search [q]uit [?]help`;
    } else if (selection.wordText) {
      const wordIdx = selection.wordIndex !== null ? ` [#${selection.wordIndex}]` : "";
      hintsText = `"${selection.wordText}"${wordIdx} · [s]peed ${bmLabel} [B]marks [t]ts [c]lear`;
    } else {
      let paraInfo = "";
      if (selection.chapterIndex !== undefined && selection.paraIndexInChapter !== undefined) {
        paraInfo = ` [ch ${selection.chapterIndex}, para ${selection.paraIndexInChapter + 1}]`;
      } else if (selection.pageIndex !== undefined) {
        paraInfo = ` [page ${selection.pageIndex + 1}]`;
      }
      hintsText = `Para selected${paraInfo} · [s]peed ${bmLabel} [B]marks [t]ts [c]lear`;
    }

    this.lastHints = hintsText; // Cache for click detection

    const gutterBot = "─".repeat(Math.floor(GUTTER / 2)) + "┴" + "─".repeat(GUTTER - Math.floor(GUTTER / 2) - 1);
    moveTo(rows - 1, 1);
    process.stdout.write(t.border + "─".repeat(colWidth) + gutterBot + "─".repeat(colWidth) + ANSI.reset);
    moveTo(rows, 1);
    process.stdout.write(
      t.dim + formatHints(hintsText, t) + ANSI.reset
    );
  }

  private getChapterTitle(_pageIdx: number): string | undefined {
    // Caller passes chapterTitle; this is a placeholder for richer lookup if available
    return this.state.chapterTitle;
  }

  // ── Key handling ───────────────────────────────────────────────────────────

  handleKey(
    key: string
  ):
    | "next"
    | "prev"
    | "bookmark"
    | "speed"
    | "scroll"
    | "quit"
    | "help"
    | "search"
    | "command"
    | "escape"
    | "tts"
    | "bookmarks"
    | "image"
    | "toc"
    | { type: "click"; row: number; col: number }
    | null {
    if (key.startsWith("mouse:")) {
      const parts = key.split(":");
      const row = parseInt(parts[1] ?? "0");
      const col = parseInt(parts[2] ?? "0");

      // Check if click is on a footer shortcut
      const shortcutKey = this.getKeyFromFooterClick(row, col);
      if (shortcutKey) {
        return this.handleKey(shortcutKey);
      }

      return { type: "click", row, col };
    }
    switch (key) {
      case "n":
      case "right":
      case "down":
        return "next";
      case "p":
      case "left":
      case "up":
        return "prev";
      case "b":
        return "bookmark";
      case "s":
        return "speed";
      case "v":
        return "scroll";
      case "q":
        return "quit";
      case "?":
        return "help";
      case "/":
        return "search";
      case ":":
        return "command";
      case "c":
      case "escape":
        return "escape";
      case "t":
        return "tts";
      case "T":
        return "toc";
      case "B":
        return "bookmarks";
      case "i":
        return "image";
      default:
        return null;
    }
  }
}
