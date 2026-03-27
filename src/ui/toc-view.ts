import type { Chapter, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo, readKey } from "./terminal";
import { themes } from "./themes";

interface TocItem {
  chapterIdx: number;
  chapter: Chapter;
  level: number;
  indent: number;
  displayLabel: string;
  expanded: boolean;
  isVisible: boolean;
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
 * Build a flat display list from hierarchical chapters with expand/collapse state.
 */
function buildDisplayList(chapters: Chapter[], expandedState: Set<number>): TocItem[] {
  const items: TocItem[] = [];

  function addItem(chapterIdx: number, baseIndent: number = 0): void {
    const chapter = chapters[chapterIdx];
    if (!chapter) return;

    const level = chapter.level ?? 1;
    const indent = baseIndent;
    const hasChildren = (chapter.children?.length ?? 0) > 0;
    const expanded = expandedState.has(chapterIdx);

    const expandIcon = hasChildren ? (expanded ? "▼ " : "▶ ") : "  ";
    const displayLabel = `${expandIcon}${chapter.title}`;

    items.push({
      chapterIdx,
      chapter,
      level,
      indent,
      displayLabel,
      expanded,
      isVisible: true,
    });

    // Add children if expanded
    if (hasChildren && expanded) {
      for (const childIdx of chapter.children || []) {
        addChildItem(childIdx, indent + 2);
      }
    }
  }

  function addChildItem(chapterIdx: number, baseIndent: number): void {
    const chapter = chapters[chapterIdx];
    if (!chapter) return;

    const indent = baseIndent;
    const hasChildren = (chapter.children?.length ?? 0) > 0;
    const expanded = expandedState.has(chapterIdx);

    const expandIcon = hasChildren ? (expanded ? "▼ " : "▶ ") : "  ";
    const displayLabel = `${expandIcon}${chapter.title}`;

    items.push({
      chapterIdx,
      chapter,
      level: chapter.level ?? 1,
      indent,
      displayLabel,
      expanded,
      isVisible: true,
    });

    // Add children if expanded
    if (hasChildren && expanded) {
      for (const childIdx of chapter.children || []) {
        addChildItem(childIdx, indent + 2);
      }
    }
  }

  // Add top-level items only (level 1)
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (!ch.parentIndex) {
      addItem(i, 0);
    }
  }

  return items;
}

/**
 * Interactive TOC view overlay.
 * Returns the chapter index to navigate to, or null if dismissed.
 */
export async function showToc(
  chapters: Chapter[],
  currentPageChapterIdx: number,
  theme: Theme
): Promise<number | null> {
  const t = themes[theme];
  const expandedState = new Set<number>();

  // Expand top-level chapters by default
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (!ch.parentIndex && ch.children && ch.children.length > 0) {
      expandedState.add(i);
    }
  }

  let displayItems = buildDisplayList(chapters, expandedState);
  let selected = displayItems.findIndex((item) => item.chapterIdx === currentPageChapterIdx);
  if (selected < 0) selected = 0;

  function render(): void {
    const { cols, rows } = getTerminalSize();
    clearScreen();

    moveTo(2, 1);
    process.stdout.write(t.accent + ANSI.bold + center("── Table of Contents ──", cols) + ANSI.reset);

    if (displayItems.length === 0) {
      moveTo(4, 1);
      process.stdout.write(t.dim + center("No chapters.", cols) + ANSI.reset);
    } else {
      const listStart = 4;
      const maxVisible = Math.max(1, rows - 6);
      const scrollOffset = Math.max(
        0,
        Math.min(selected - Math.floor(maxVisible / 2), displayItems.length - maxVisible)
      );

      for (let i = 0; i < Math.min(maxVisible, displayItems.length); i++) {
        const itemIdx = i + scrollOffset;
        const item = displayItems[itemIdx];
        if (!item) break;
        const isSelected = itemIdx === selected;
        const isCurrent = item.chapterIdx === currentPageChapterIdx;

        const indentStr = " ".repeat(item.indent);
        const prefix = isCurrent ? `${t.accent}▸${ANSI.reset} ` : "  ";
        const label = `${prefix}${indentStr}${item.displayLabel}`;

        moveTo(listStart + i, 1);
        if (isSelected) {
          process.stdout.write(t.selectionBg + padToWidth(label, cols) + ANSI.reset);
        } else {
          process.stdout.write(padToWidth(label, cols));
        }
      }
    }

    const { rows: r, cols: c } = getTerminalSize();
    moveTo(r - 1, 1);
    process.stdout.write(t.border + "─".repeat(c) + ANSI.reset);
    moveTo(r, 1);
    if (displayItems.length > 0) {
      process.stdout.write(
        t.dim + `↑↓ select  ` + ANSI.reset +
        t.dim + `←→ expand  ` + ANSI.reset +
        t.dim + `[enter] jump  ` + ANSI.reset +
        t.dim + `[q] back` + ANSI.reset
      );
    } else {
      process.stdout.write(
        t.dim + `[q] back` + ANSI.reset
      );
    }
  }

  render();

  while (true) {
    const key = await readKey();

    if (key === "escape" || key === "q" || key === "c") return null;

    if (displayItems.length === 0) continue;

    if (key === "up" || key === "k") {
      selected = Math.max(0, selected - 1);
      render();
    } else if (key === "down" || key === "j") {
      selected = Math.min(displayItems.length - 1, selected + 1);
      render();
    } else if (key === "right") {
      // Expand current item
      const item = displayItems[selected];
      if (item && (item.chapter.children?.length ?? 0) > 0 && !item.expanded) {
        expandedState.add(item.chapterIdx);
        displayItems = buildDisplayList(chapters, expandedState);
        // Adjust selected if needed
        selected = Math.min(selected, displayItems.length - 1);
        render();
      }
    } else if (key === "left") {
      // Collapse current item or jump to parent
      const item = displayItems[selected];
      if (item && (item.chapter.children?.length ?? 0) > 0 && item.expanded) {
        expandedState.delete(item.chapterIdx);
        displayItems = buildDisplayList(chapters, expandedState);
        selected = Math.min(selected, displayItems.length - 1);
        render();
      } else if (item && item.chapter.parentIndex !== undefined) {
        // Jump to parent
        const parentIdx = displayItems.findIndex((x) => x.chapterIdx === item.chapter.parentIndex);
        if (parentIdx >= 0) {
          selected = parentIdx;
          render();
        }
      }
    } else if (key === "enter") {
      return displayItems[selected]?.chapterIdx ?? null;
    }
  }
}
