import type { Bookmark, Theme } from "../types";
import { parsePosition } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo, readKey } from "./terminal";
import { themes } from "./themes";

function positionLabel(posStr: string): string {
  const pos = parsePosition(posStr);
  if (pos.type === "page") return `Page ${pos.page + 1}`;
  if (pos.type === "word") return `Word ${pos.index}`;
  if (pos.type === "scroll") return `Line ${pos.offset}`;
  return posStr;
}

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
 * Interactive bookmark list overlay.
 * Returns the position string to navigate to, or null if dismissed.
 * Calls onDelete(originalIndex) when the user deletes a bookmark.
 */
export async function showBookmarks(
  initialBookmarks: Bookmark[],
  theme: Theme,
  onDelete: (originalIndex: number) => Promise<void>
): Promise<string | null> {
  const t = themes[theme];
  // Track items with their original indices so deletion works correctly
  const items = initialBookmarks.map((bm, i) => ({ bm, origIdx: i }));
  let selected = 0;

  function render(): void {
    const { cols, rows } = getTerminalSize();
    clearScreen();

    moveTo(2, 1);
    process.stdout.write(t.accent + ANSI.bold + center("── Bookmarks ──", cols) + ANSI.reset);

    if (items.length === 0) {
      moveTo(4, 1);
      process.stdout.write(t.dim + center("No bookmarks.", cols) + ANSI.reset);
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
        const pos = positionLabel(item.bm.position);
        const note = item.bm.note ? `  ${ANSI.dim}${item.bm.note}${ANSI.reset}` : "";
        const date = formatDate(item.bm.timestamp);
        const dateStr = `  ${t.dim}${date}${ANSI.reset}  `;
        const dateVisible = 2 + visLen(date) + 2;

        const leftText = `${num}${pos}`;
        const leftVisible = visLen(leftText) + (item.bm.note ? 2 + item.bm.note.length : 0);
        const gap = Math.max(1, cols - leftVisible - dateVisible);

        moveTo(listStart + i, 1);
        if (isSelected) {
          const line = `${num}${t.accent}${ANSI.bold}${pos}${ANSI.reset}${note}`;
          process.stdout.write(t.selectionBg + padToWidth(line, cols - dateVisible) + dateStr + ANSI.reset);
        } else {
          const line = `${num}${t.text}${pos}${ANSI.reset}${note}`;
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
        ` navigate  ` + ANSI.reset + t.accent + ANSI.bold + `d` + ANSI.reset + t.dim +
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
      return items[selected]?.bm.position ?? null;
    } else if (key === "d") {
      const item = items[selected];
      if (item) {
        await onDelete(item.origIdx);
        items.splice(selected, 1);
        selected = Math.max(0, Math.min(selected, items.length - 1));
        render();
      }
    }
  }
}
