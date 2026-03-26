import type { FileState, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo, readKey } from "./terminal";
import { themes } from "./themes";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function center(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  const pad = Math.floor((width - str.length) / 2);
  return " ".repeat(pad) + str + " ".repeat(width - str.length - pad);
}

function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padToWidth(str: string, width: number): string {
  const vl = visLen(str);
  if (vl >= width) return str;
  return str + " ".repeat(width - vl);
}

/**
 * Book list item with hash for selection/deletion.
 */
interface BookItem {
  hash: string;
  state: FileState;
}

/**
 * Interactive books list overlay.
 * Returns the hash of the selected book to open, or null if dismissed.
 * Calls onDelete(hash) when the user deletes a book.
 */
export async function showBooksList(
  books: BookItem[],
  theme: Theme,
  onDelete: (hash: string) => Promise<void>
): Promise<string | null> {
  const t = themes[theme];
  // Track items with their original indices
  const items = books.map((item, i) => ({ ...item, origIdx: i }));
  let selected = 0;

  function render(): void {
    const { cols, rows } = getTerminalSize();
    clearScreen();

    moveTo(2, 1);
    process.stdout.write(t.accent + ANSI.bold + center("── Books ──", cols) + ANSI.reset);

    if (items.length === 0) {
      moveTo(4, 1);
      process.stdout.write(t.dim + center("No books read yet.", cols) + ANSI.reset);
    } else {
      const listStart = 4;
      const maxVisible = Math.max(1, rows - 6);
      const scrollOffset = Math.max(
        0,
        Math.min(selected - Math.floor(maxVisible / 2), items.length - maxVisible)
      );

      for (let i = 0; i < Math.min(maxVisible, items.length); i++) {
        const itemIdx = i + scrollOffset;
        const item = items[itemIdx];
        if (!item) break;
        const isSelected = itemIdx === selected;

        const num = `  ${String(itemIdx + 1).padStart(2)}.  `;
        const title = item.state.title || item.state.source;
        const date = formatDate(item.state.lastRead);
        const dateStr = `  ${t.dim}${date}${ANSI.reset}  `;
        const dateVisible = 2 + visLen(date) + 2;

        const leftText = `${num}${title}`;
        const leftVisible = visLen(leftText);
        const gap = Math.max(1, cols - leftVisible - dateVisible);

        moveTo(listStart + i, 1);
        if (isSelected) {
          const line = `${num}${t.accent}${ANSI.bold}${title}${ANSI.reset}`;
          process.stdout.write(t.selectionBg + padToWidth(line, cols - dateVisible) + dateStr + ANSI.reset);
        } else {
          const line = `${num}${t.text}${title}${ANSI.reset}`;
          process.stdout.write(padToWidth(line, cols - dateVisible) + dateStr + ANSI.reset);
        }
      }
    }

    const { rows: r, cols: c } = getTerminalSize();
    moveTo(r - 1, 1);
    process.stdout.write(t.border + "─".repeat(c) + ANSI.reset);
    moveTo(r, 1);
    if (items.length > 0) {
      process.stdout.write(
        t.dim +
        `↑↓ select  ` + ANSI.reset + t.accent + ANSI.bold + `enter` + ANSI.reset + t.dim +
        ` open  ` + ANSI.reset + t.accent + ANSI.bold + `d` + ANSI.reset + t.dim +
        ` delete  ` + ANSI.reset + t.accent + ANSI.bold + `esc` + ANSI.reset + t.dim +
        ` close` + ANSI.reset
      );
    } else {
      process.stdout.write(
        t.accent + ANSI.bold + `esc` + ANSI.reset + t.dim + ` close` + ANSI.reset
      );
    }
  }

  render();

  while (true) {
    const key = await readKey();

    if (key === "escape" || key === "q") return null;

    if (items.length === 0) continue;

    if (key === "up" || key === "k") {
      selected = Math.max(0, selected - 1);
      render();
    } else if (key === "down" || key === "j") {
      selected = Math.min(items.length - 1, selected + 1);
      render();
    } else if (key === "enter") {
      return items[selected]?.hash ?? null;
    } else if (key === "d") {
      const item = items[selected];
      if (item) {
        await onDelete(item.hash);
        items.splice(selected, 1);
        selected = Math.max(0, Math.min(selected, items.length - 1));
        render();
      }
    }
  }
}
