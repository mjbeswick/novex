import type { Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo } from "./terminal";
import { themes } from "./themes";
import type { ColorTheme } from "./themes";

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

function formatHints(text: string, t: ColorTheme): string {
  return text.replace(/\[([^\]]+)\](\w*)/g, (_m, key: string, rest: string) => {
    const sep = (key.length === 1 && /[a-zA-Z]/.test(key)) ? "" : (rest ? " " : "");
    return `${ANSI.reset}${t.accent}${ANSI.bold}${key}${ANSI.reset}${t.dim}${sep}${rest}`;
  });
}

function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padEnd(str: string, width: number): string {
  const v = visLen(str);
  if (v >= width) return str;
  return str + " ".repeat(width - v);
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
    const contentRows = rows - 4;
    const maxOffset = Math.max(0, lines.length - contentRows);
    if (maxOffset === 0) return 100;
    return Math.round((offset / maxOffset) * 100);
  }

  render(): void {
    const { lines, offset, theme, bookmarkCount, title } = this.state;
    const t = themes[theme];
    const { cols, rows } = getTerminalSize();

    clearScreen();

    const contentRows = rows - 4; // header + sep + footer-sep + hints

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

    // ── Footer separator + hints ──────────────────────────────────────────────
    moveTo(rows - 1, 1);
    process.stdout.write(t.border + "─".repeat(cols) + ANSI.reset);
    moveTo(rows, 1);
    const hint =
      t.dim + formatHints("[↑][↓] scroll | [PgUp]/[PgDn] page | [b]ookmark [p]age [s]peed [?]help", t) + ANSI.reset;
    process.stdout.write(hint);
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
      case "q":
        return "page-mode";
      case "s":
        return "speed";
      case "?":
        return "help";
      default:
        return null;
    }
  }
}
