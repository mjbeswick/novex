import type { Page, Theme } from "../types";
import { ANSI, clearLine, getTerminalSize, moveTo } from "./terminal";
import { themes } from "./themes";

export interface SearchResult {
  pageIndex: number;
  lineIndex: number;
  matchStart: number;
  matchEnd: number;
}

/**
 * Search all pages for a case-insensitive query string.
 * Returns every match as a SearchResult (first match per line occurrence).
 */
export function searchContent(pages: Page[], query: string): SearchResult[] {
  if (!query) return [];

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    for (let li = 0; li < page.lines.length; li++) {
      const line = page.lines[li];
      const lowerLine = line.toLowerCase();

      let start = 0;
      while (true) {
        const idx = lowerLine.indexOf(lowerQuery, start);
        if (idx === -1) break;
        results.push({
          pageIndex: pi,
          lineIndex: li,
          matchStart: idx,
          matchEnd: idx + query.length,
        });
        start = idx + 1;
      }
    }
  }

  return results;
}

/**
 * Return a copy of `line` with the matched region wrapped in highlight ANSI codes.
 */
export function highlightMatch(
  line: string,
  start: number,
  end: number,
  theme: Theme
): string {
  const t = themes[theme];
  const before = line.slice(0, start);
  const match = line.slice(start, end);
  const after = line.slice(end);
  return (
    before +
    t.highlight +
    ANSI.bold +
    match +
    ANSI.reset +
    t.text +
    after +
    ANSI.reset
  );
}

// ── SearchBar ─────────────────────────────────────────────────────────────────

export class SearchBar {
  private theme: Theme;

  constructor(theme: Theme) {
    this.theme = theme;
  }

  /**
   * Render a search bar at the bottom of the screen.
   * Call this each time the query changes while the user is typing.
   */
  render(query: string): void {
    const t = themes[this.theme];
    const { cols, rows } = getTerminalSize();

    moveTo(rows, 1);
    clearLine();

    const prompt = "/";
    const maxQueryLen = cols - prompt.length - 2;
    const displayQuery = query.slice(-maxQueryLen); // show tail if too long

    process.stdout.write(
      t.accent +
        ANSI.bold +
        prompt +
        ANSI.reset +
        t.text +
        displayQuery +
        ANSI.reset +
        "\x1b[?25h" // show cursor while typing
    );
  }
}
