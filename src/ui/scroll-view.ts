import type { Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo } from "./terminal";
import { themes } from "./themes";

export interface ScrollViewState {
  lines: string[];
  offset: number;
  theme: Theme;
  lineWidth?: number;
  bookmarkCount: number;
  title: string;
}

function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "━".repeat(filled) + "─".repeat(empty);
}

function padEnd(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

export class ScrollView {
  private state: ScrollViewState;

  constructor(state: ScrollViewState) {
    this.state = { ...state };
  }

  updateState(state: Partial<ScrollViewState>): void {
    this.state = { ...this.state, ...state };
  }

  getProgress(): number {
    const { lines, offset } = this.state;
    const { rows } = getTerminalSize();
    const contentRows = rows - 3;
    const maxOffset = Math.max(0, lines.length - contentRows);
    if (maxOffset === 0) return 100;
    return Math.round((offset / maxOffset) * 100);
  }

  render(): void {
    const { lines, offset, theme, bookmarkCount, title } = this.state;
    const t = themes[theme];
    const { cols, rows } = getTerminalSize();

    clearScreen();

    const contentRows = rows - 3; // header + sep + hints

    // ── Header (with status integrated) ───────────────────────────────────────
    const progress = this.getProgress();
    const statusRight = `${progress}%  bookmarks: ${bookmarkCount}`;
    const gap = cols - title.length - statusRight.length;
    const headerLine = title + " ".repeat(Math.max(gap, 1)) + statusRight;

    moveTo(1, 1);
    process.stdout.write(
      t.accent + ANSI.bold + headerLine.slice(0, cols) + ANSI.reset
    );

    // ── Separator ─────────────────────────────────────────────────────────────
    moveTo(2, 1);
    process.stdout.write(t.border + "─".repeat(cols) + ANSI.reset);

    // ── Content ───────────────────────────────────────────────────────────────
    for (let i = 0; i < contentRows; i++) {
      moveTo(i + 3, 1);
      const raw = lines[offset + i] ?? "";
      process.stdout.write(t.text + padEnd(raw, cols) + ANSI.reset);
    }

    // ── Hints ─────────────────────────────────────────────────────────────────
    moveTo(rows, 1);
    const hint =
      t.dim +
      "[↑][↓] scroll | [PgUp][PgDn] page | [b]ookmark [p]age [s]peed [q]uit [?]help" +
      ANSI.reset;
    process.stdout.write(padEnd(hint, cols));
  }

  handleKey(
    key: string
  ):
    | "scroll-down"
    | "scroll-up"
    | "page-down"
    | "page-up"
    | "bookmark"
    | "page-mode"
    | "speed"
    | "quit"
    | "help"
    | null {
    switch (key) {
      case "down":
      case "j":
        return "scroll-down";
      case "up":
      case "k":
        return "scroll-up";
      case "pagedown":
      case " ":
        return "page-down";
      case "pageup":
        return "page-up";
      case "b":
        return "bookmark";
      case "p":
        return "page-mode";
      case "s":
        return "speed";
      case "q":
        return "quit";
      case "?":
        return "help";
      default:
        return null;
    }
  }
}
