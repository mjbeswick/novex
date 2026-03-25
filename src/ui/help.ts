import type { ReadingMode, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo, readKey } from "./terminal";
import { themes } from "./themes";

interface HelpSection {
  heading: string;
  keys: Array<{ key: string; action: string }>;
}

function getHelpContent(mode: ReadingMode): HelpSection[] {
  const common: HelpSection = {
    heading: "Global",
    keys: [
      { key: "q", action: "Quit" },
      { key: "m", action: "Switch reading mode" },
      { key: "?", action: "Show this help" },
    ],
  };

  switch (mode) {
    case "page":
      return [
        {
          heading: "Page Reader",
          keys: [
            { key: "n / →", action: "Next page" },
            { key: "p / ←", action: "Previous page" },
            { key: "b", action: "Add bookmark" },
            { key: "/", action: "Search" },
            { key: ":", action: "Command" },
          ],
        },
        common,
      ];

    case "scroll":
      return [
        {
          heading: "Scroll View",
          keys: [
            { key: "↑ / k", action: "Scroll up" },
            { key: "↓ / j", action: "Scroll down" },
            { key: "PgUp", action: "Page up" },
            { key: "PgDn / space", action: "Page down" },
            { key: "b", action: "Add bookmark" },
          ],
        },
        common,
      ];

    case "speed":
      return [
        {
          heading: "Speed Reader",
          keys: [
            { key: "space", action: "Pause / Resume" },
            { key: "→", action: "Skip forward one chunk" },
            { key: "←", action: "Skip back one chunk" },
            { key: "↑", action: "Skip forward one sentence" },
            { key: "↓", action: "Skip back one sentence" },
            { key: "+ / =", action: "Increase WPM" },
            { key: "-", action: "Decrease WPM" },
            { key: "]", action: "Increase chunk size" },
            { key: "[", action: "Decrease chunk size" },
          ],
        },
        common,
      ];

  }
}

function center(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  const pad = Math.floor((width - str.length) / 2);
  return " ".repeat(pad) + str + " ".repeat(width - str.length - pad);
}

function padEnd(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

export async function showHelp(mode: ReadingMode, theme: Theme): Promise<void> {
  const t = themes[theme];
  const { cols, rows } = getTerminalSize();
  const sections = getHelpContent(mode);

  clearScreen();

  let row = 2;

  moveTo(row++, 1);
  process.stdout.write(
    t.accent + ANSI.bold + center("─── Help ───", cols) + ANSI.reset
  );
  row++;

  for (const section of sections) {
    moveTo(row++, 1);
    process.stdout.write(
      t.highlight + ANSI.bold + center(section.heading, cols) + ANSI.reset
    );

    for (const { key, action } of section.keys) {
      if (row >= rows - 2) break;
      moveTo(row++, 1);
      const line = padEnd(`  ${key.padEnd(22)} ${action}`, cols);
      process.stdout.write(t.text + line + ANSI.reset);
    }
    row++;
  }

  // Footer
  moveTo(rows - 1, 1);
  process.stdout.write(
    t.border + "─".repeat(cols) + ANSI.reset
  );
  moveTo(rows, 1);
  process.stdout.write(
    t.dim + center("Press any key to close help", cols) + ANSI.reset
  );

  await readKey();
}
