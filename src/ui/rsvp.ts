import type { Word, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo } from "./terminal";
import { themes } from "./themes";

export interface RSVPState {
  words: Word[];
  currentWord: number;
  wpm: number;
  contextMode: boolean;
  paused: boolean;
  theme: Theme;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "━".repeat(filled) + "─".repeat(empty);
}

function center(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  const pad = Math.floor((width - str.length) / 2);
  return " ".repeat(pad) + str + " ".repeat(width - str.length - pad);
}

// ── RSVPView ───────────────────────────────────────────────────────────────────

export class RSVPView {
  private state: RSVPState;

  constructor(state: RSVPState) {
    this.state = { ...state };
  }

  updateState(state: Partial<RSVPState>): void {
    this.state = { ...this.state, ...state };
  }

  getProgress(): number {
    const { words, currentWord } = this.state;
    if (words.length <= 1) return 100;
    return Math.round((currentWord / (words.length - 1)) * 100);
  }

  render(): void {
    const { words, currentWord, wpm, contextMode, paused, theme } = this.state;
    const t = themes[theme];
    const { cols, rows } = getTerminalSize();

    clearScreen();

    const progress = this.getProgress();
    const midRow = Math.floor(rows / 2);

    // Context words
    const prevWord = currentWord > 0 ? words[currentWord - 1]?.text ?? "" : "";
    const focusWord = words[currentWord]?.text ?? "";
    const nextWord =
      currentWord < words.length - 1
        ? words[currentWord + 1]?.text ?? ""
        : "";

    // ── Status header ─────────────────────────────────────────────────────────
    const contextLabel = contextMode ? "on" : "off";
    const headerText = `Context: ${contextLabel} | WPM: ${wpm}${paused ? "  [PAUSED]" : ""}`;
    moveTo(midRow - 3, 1);
    process.stdout.write(t.dim + center(headerText, cols) + ANSI.reset);

    // ── Word display ──────────────────────────────────────────────────────────
    moveTo(midRow - 1, 1);
    if (contextMode) {
      const display =
        t.dim +
        prevWord +
        ANSI.reset +
        " " +
        t.accent +
        ANSI.bold +
        "[" +
        focusWord +
        "]" +
        ANSI.reset +
        " " +
        t.dim +
        nextWord +
        ANSI.reset;

      // Build a plain version for centering calculation
      const plainLen =
        (prevWord ? prevWord.length + 1 : 0) +
        focusWord.length +
        2 + // brackets
        (nextWord ? 1 + nextWord.length : 0);
      const pad = Math.max(0, Math.floor((cols - plainLen) / 2));
      process.stdout.write(" ".repeat(pad) + display);
    } else {
      process.stdout.write(
        t.accent + ANSI.bold + center(focusWord, cols) + ANSI.reset
      );
    }

    // ── Progress bar ──────────────────────────────────────────────────────────
    const barWidth = Math.min(cols - 4, 60);
    const bar = progressBar(progress, barWidth);
    const barLine = bar + ` ${progress}%`;
    moveTo(midRow + 1, 1);
    process.stdout.write(t.accent + center(barLine, cols) + ANSI.reset);

    // ── Key hints ─────────────────────────────────────────────────────────────
    moveTo(midRow + 3, 1);
    const hint =
      t.dim +
      "[space] pause | [c] context | [→][←] word | [↑][↓] sentence | [+][-] wpm | [q] quit" +
      ANSI.reset;
    process.stdout.write(center(hint, cols));
  }

  handleKey(
    key: string
  ):
    | "pause"
    | "next"
    | "prev"
    | "skip-sentence-fwd"
    | "skip-sentence-back"
    | "context-toggle"
    | "wpm-up"
    | "wpm-down"
    | "quit"
    | null {
    switch (key) {
      case "space":
        return "pause";
      case "right":
        return "next";
      case "left":
        return "prev";
      case "up":
        return "skip-sentence-fwd";
      case "down":
        return "skip-sentence-back";
      case "c":
        return "context-toggle";
      case "+":
      case "=":
        return "wpm-up";
      case "-":
        return "wpm-down";
      case "q":
        return "quit";
      default:
        return null;
    }
  }
}
