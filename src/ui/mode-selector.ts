import type { ReadingMode, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo } from "./terminal";
import { themes } from "./themes";

interface ModeOption {
  mode: ReadingMode;
  key: string;
  label: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: "page",
    key: "1",
    label: "Page Reader",
    description: "Classic page-by-page reading",
  },
  {
    mode: "scroll",
    key: "2",
    label: "Scroll View",
    description: "Continuous scrolling text",
  },
  {
    mode: "speed",
    key: "3",
    label: "Speed Reader",
    description: "Flash chunks of words at a set WPM",
  },
];

function center(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  const pad = Math.floor((width - str.length) / 2);
  return " ".repeat(pad) + str + " ".repeat(width - str.length - pad);
}

export class ModeSelector {
  private currentMode: ReadingMode;
  private theme: Theme;
  private selectedIndex: number;

  constructor(currentMode: ReadingMode, theme: Theme) {
    this.currentMode = currentMode;
    this.theme = theme;
    this.selectedIndex = MODE_OPTIONS.findIndex(
      (o) => o.mode === currentMode
    );
    if (this.selectedIndex < 0) this.selectedIndex = 0;
  }

  render(): void {
    const t = themes[this.theme];
    const { cols, rows } = getTerminalSize();

    clearScreen();

    const boxWidth = Math.min(cols - 4, 60);
    const startRow = Math.max(1, Math.floor((rows - MODE_OPTIONS.length * 2 - 6) / 2));

    // ── Title ─────────────────────────────────────────────────────────────────
    moveTo(startRow, 1);
    process.stdout.write(
      t.accent + ANSI.bold + center("Select Reading Mode", cols) + ANSI.reset
    );

    moveTo(startRow + 1, 1);
    process.stdout.write(t.border + center("─".repeat(boxWidth), cols) + ANSI.reset);

    // ── Mode list ─────────────────────────────────────────────────────────────
    MODE_OPTIONS.forEach((opt, i) => {
      const row = startRow + 2 + i * 2;
      const isSelected = i === this.selectedIndex;
      const isCurrent = opt.mode === this.currentMode;

      const marker = isSelected ? "▶ " : "  ";
      const currentTag = isCurrent ? " (current)" : "";
      const label = `[${opt.key}] ${opt.label}${currentTag}`;
      const desc = `     ${opt.description}`;

      moveTo(row, 1);
      if (isSelected) {
        process.stdout.write(
          t.highlight +
            ANSI.bold +
            center(marker + label, cols) +
            ANSI.reset
        );
      } else {
        process.stdout.write(
          t.text + center(marker + label, cols) + ANSI.reset
        );
      }

      moveTo(row + 1, 1);
      process.stdout.write(t.dim + center(desc, cols) + ANSI.reset);
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerRow =
      startRow + 2 + MODE_OPTIONS.length * 2 + 1;
    moveTo(footerRow, 1);
    process.stdout.write(
      t.border + center("─".repeat(boxWidth), cols) + ANSI.reset
    );
    moveTo(footerRow + 1, 1);
    process.stdout.write(
      t.dim +
        center("[1-3] select  [↑][↓] navigate  [enter] confirm  [esc] cancel", cols) +
        ANSI.reset
    );
  }

  handleKey(key: string): ReadingMode | "cancel" | null {
    // Direct number keys
    const byKey = MODE_OPTIONS.find((o) => o.key === key);
    if (byKey) {
      this.selectedIndex = MODE_OPTIONS.indexOf(byKey);
      return byKey.mode;
    }

    switch (key) {
      case "up":
        this.selectedIndex =
          (this.selectedIndex - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length;
        this.render();
        return null;
      case "down":
        this.selectedIndex =
          (this.selectedIndex + 1) % MODE_OPTIONS.length;
        this.render();
        return null;
      case "enter":
        return MODE_OPTIONS[this.selectedIndex].mode;
      case "escape":
      case "q":
        return "cancel";
      default:
        return null;
    }
  }
}
