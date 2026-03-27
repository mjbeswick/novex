import { resolve, dirname, basename, join, relative } from "node:path";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Theme } from "./types.ts";
import { ANSI, getTerminalSize, moveTo } from "./ui/terminal.ts";
import { themes } from "./ui/themes.ts";

/** Reading extensions that the interactive browser will list */
const READING_EXTENSIONS = [".epub", ".docx", ".fb2", ".md", ".markdown", ".txt", ".html", ".htm"];

/**
 * Reads a file from disk, returns its buffer and resolved path.
 */
export async function readFromFile(
  filePath: string
): Promise<{ buffer: Uint8Array; source: string }> {
  const source = resolve(filePath);
  const file = Bun.file(source);
  const buffer = new Uint8Array(await file.arrayBuffer());
  return { buffer, source };
}

/**
 * Reads all bytes from process.stdin until EOF.
 */
export async function readFromStdin(): Promise<{
  buffer: Uint8Array;
  source: string;
}> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return { buffer, source: "stdin" };
}

/**
 * Returns true if stdin is being piped (not a TTY).
 */
export function isStdinPiped(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Shows a simple interactive file browser in the current directory.
 * Lists files with common reading extensions.
 * Uses raw mode keyboard input for up/down/enter navigation.
 * Returns the selected file path, or null if cancelled (Escape / q).
 */
export async function selectFileInteractive(): Promise<string | null> {
  // Collect eligible files from the current directory
  const glob = new Bun.Glob(`*.{epub,docx,fb2,md,txt,html,htm}`);
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
    files.push(file);
  }

  files.sort();

  if (files.length === 0) {
    process.stdout.write("No readable files found in current directory.\n");
    return null;
  }

  let selectedIndex = 0;

  const CURSOR_UP = "\x1b[A";
  const CURSOR_DOWN = "\x1b[B";
  const ENTER = "\r";
  const ENTER_LF = "\n";
  const ESCAPE = "\x1b";
  const CTRL_C = "\x03";
  const KEY_Q = "q";

  const renderMenu = () => {
    // Move cursor up by the number of previously rendered lines
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen, move to top
    process.stdout.write("Select a file to open (↑/↓ to navigate, Enter to select, q/Esc to cancel):\n\n");
    for (let i = 0; i < files.length; i++) {
      if (i === selectedIndex) {
        process.stdout.write(`  \x1b[7m${files[i]}\x1b[0m\n`); // reverse video for selection
      } else {
        process.stdout.write(`  ${files[i]}\n`);
      }
    }
  };

  return new Promise<string | null>((resolvePromise) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    renderMenu();

    const onData = (key: string) => {
      if (key === CURSOR_UP) {
        selectedIndex = (selectedIndex - 1 + files.length) % files.length;
        renderMenu();
      } else if (key === CURSOR_DOWN) {
        selectedIndex = (selectedIndex + 1) % files.length;
        renderMenu();
      } else if (key === ENTER || key === ENTER_LF) {
        cleanup();
        const selected = resolve(process.cwd(), files[selectedIndex]);
        process.stdout.write("\x1b[2J\x1b[H"); // clear screen
        resolvePromise(selected);
      } else if (key === ESCAPE || key === KEY_Q || key === CTRL_C) {
        cleanup();
        process.stdout.write("\x1b[2J\x1b[H"); // clear screen
        resolvePromise(null);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    process.stdin.on("data", onData);
  });
}

/**
 * Recursively scans a directory for readable book files and returns an interactive selector.
 * Returns the selected file path, or null if cancelled.
 */
export async function browseDirectory(searchDir: string = process.cwd(), theme: Theme = "dark"): Promise<string | null> {
  // Check if directory exists and is accessible
  try {
    // Expand ~ if needed, then resolve to absolute path
    let dir = searchDir.startsWith("~") ? searchDir.replace("~", Bun.env.HOME || "") : searchDir;
    const resolvedDir = resolve(dir);

    // Verify the path is a valid, accessible directory by attempting to list it
    try {
      const glob = new Bun.Glob("*");
      for await (const _ of glob.scan({ cwd: resolvedDir, onlyFiles: false })) {
        break;
      }
    } catch {
      process.stderr.write(`\nDirectory not found: ${resolvedDir}\n`);
      await new Promise(r => setTimeout(r, 1500));
      return null;
    }

    // Use the resolved directory for the rest of the function
    return await browseDirContent(resolvedDir, theme);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nError accessing directory: ${msg}\n`);
    await new Promise(r => setTimeout(r, 1500));
    return null;
  }
}

const BOOK_GLOB_PATTERN = `*.{epub,docx,fb2,md,markdown,txt,html,htm}`;
const BOOK_GLOB_PATTERN_DEEP = `**/*.{epub,docx,fb2,md,markdown,txt,html,htm}`;

/** Returns true if a filename has a readable book extension. */
function isBookFile(name: string): boolean {
  return READING_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

/** List immediate subdirectories and book files in a directory. */
async function listDir(dir: string): Promise<{ dirs: string[]; files: string[] }> {
  const dirs: string[] = [];
  const files: string[] = [];
  const glob = new Bun.Glob("*");
  for await (const entry of glob.scan({ cwd: dir, onlyFiles: false })) {
    try {
      const stat = statSync(join(dir, entry));
      if (stat.isDirectory()) {
        dirs.push(entry);
      } else if (isBookFile(entry)) {
        files.push(entry);
      }
    } catch {
      // Inaccessible entry, skip
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return { dirs, files };
}

/** Deep search for book files matching a query string. */
async function deepSearch(rootDir: string, query: string): Promise<string[]> {
  const results: string[] = [];
  const lowerQuery = query.toLowerCase();
  const glob = new Bun.Glob(BOOK_GLOB_PATTERN_DEEP);
  for await (const file of glob.scan({ cwd: rootDir, onlyFiles: true })) {
    if (file.toLowerCase().includes(lowerQuery)) {
      results.push(file);
    }
  }
  results.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return results;
}

type BrowseEntry = { type: "parent" } | { type: "dir"; name: string } | { type: "file"; name: string; relPath?: string };

function hotkeyLabel(t: (typeof themes)[Theme], hotkey: string, label: string): string {
  const index = label.toLowerCase().indexOf(hotkey.toLowerCase());
  if (index === -1) return t.dim + label + ANSI.reset;
  return (
    t.dim +
    label.slice(0, index) +
    ANSI.reset +
    t.accent +
    ANSI.bold +
    label[index] +
    ANSI.reset +
    t.dim +
    label.slice(index + 1) +
    ANSI.reset
  );
}

/**
 * Interactive file manager for browsing directories.
 * Navigate with arrow keys, enter directories, / to search recursively.
 */
async function browseDirContent(rootDir: string, theme: Theme = "dark"): Promise<string | null> {
  const t = themes[theme];
  let currentDir = rootDir;
  let entries: BrowseEntry[] = [];
  let selectedIndex = 0;
  let searchMode = false;
  let searchQuery = "";
  let searchResults: string[] | null = null;

  const buildEntries = async () => {
    entries = [];
    if (searchResults !== null) {
      for (const relPath of searchResults) {
        entries.push({ type: "file", name: relPath, relPath });
      }
    } else {
      if (currentDir !== rootDir) {
        entries.push({ type: "parent" });
      }
      const { dirs, files } = await listDir(currentDir);
      for (const d of dirs) entries.push({ type: "dir", name: d });
      for (const f of files) entries.push({ type: "file", name: f });
    }
    selectedIndex = 0;
  };

  await buildEntries();

  const CURSOR_UP = "\x1b[A";
  const CURSOR_DOWN = "\x1b[B";
  const ENTER = "\r";
  const ENTER_LF = "\n";
  const ESCAPE = "\x1b";
  const CTRL_C = "\x03";
  const BACKSPACE = "\x7f";
  const BACKSPACE2 = "\b";

  const renderMenu = () => {
    const { rows, cols } = getTerminalSize();
    process.stdout.write("\x1b[2J\x1b[H");

    // Header
    if (searchMode) {
      process.stdout.write(t.accent + ANSI.bold + "Search: " + ANSI.reset + t.text + searchQuery + ANSI.reset + "\x1b[K\n\n");
    } else if (searchResults !== null) {
      process.stdout.write(t.accent + ANSI.bold + `Results for "${searchQuery}"` + ANSI.reset + "\n\n");
    } else {
      const displayDir = currentDir === rootDir ? basename(currentDir) : relative(rootDir, currentDir);
      process.stdout.write(t.accent + ANSI.bold + (displayDir || basename(currentDir)) + "/" + ANSI.reset + "\n\n");
    }

    if (entries.length === 0) {
      if (searchResults !== null) {
        process.stdout.write("  " + t.dim + "No matches found" + ANSI.reset + "\n");
      } else {
        process.stdout.write("  " + t.dim + "Empty directory" + ANSI.reset + "\n");
      }
    } else {
      // Scroll window — reserve 4 lines for header (2) + footer separator + hotkey bar
      const maxVisible = rows - 4;
      let start = 0;
      if (entries.length > maxVisible) {
        start = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
        if (start + maxVisible > entries.length) start = entries.length - maxVisible;
      }
      const end = Math.min(entries.length, start + maxVisible);

      for (let i = start; i < end; i++) {
        const entry = entries[i];
        let label: string;
        if (entry.type === "parent") {
          label = t.dim + "../" + ANSI.reset;
        } else if (entry.type === "dir") {
          label = t.accent + entry.name + "/" + ANSI.reset;
        } else {
          label = entry.relPath
            ? t.dim + dirname(entry.relPath) + "/" + ANSI.reset + t.text + basename(entry.name) + ANSI.reset
            : t.text + entry.name + ANSI.reset;
        }

        if (i === selectedIndex) {
          process.stdout.write("  " + t.highlight + ANSI.bold + "> " + ANSI.reset + label + "\n");
        } else {
          process.stdout.write("    " + label + "\n");
        }
      }
    }

    // Footer: separator line + hotkey bar
    moveTo(rows - 1, 1);
    process.stdout.write(t.border + "\u2500".repeat(cols) + ANSI.reset);
    moveTo(rows, 1);
    if (searchMode) {
      process.stdout.write(
        t.dim + "type to filter  " + ANSI.reset +
        hotkeyLabel(t, "e", "enter") +
        t.dim + "  " + ANSI.reset +
        hotkeyLabel(t, "s", "esc cancel")
      );
    } else if (searchResults !== null) {
      process.stdout.write(
        t.dim + "\u2191\u2193 select  " + ANSI.reset +
        hotkeyLabel(t, "o", "open") +
        t.dim + "  " + ANSI.reset +
        hotkeyLabel(t, "s", "esc back") +
        t.dim + "  " + ANSI.reset +
        hotkeyLabel(t, "c", "close")
      );
    } else {
      const canGoBack = currentDir !== rootDir;
      process.stdout.write(
        t.dim + "\u2191\u2193 select  " + ANSI.reset +
        hotkeyLabel(t, "o", "open") +
        t.dim + "  " + ANSI.reset +
        hotkeyLabel(t, "/", "/ search") +
        t.dim + "  " + ANSI.reset +
        (canGoBack
          ? hotkeyLabel(t, "s", "esc back") + t.dim + "  " + ANSI.reset
          : "") +
        hotkeyLabel(t, "c", "close")
      );
    }
  };

  return new Promise<string | null>((resolvePromise) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    renderMenu();

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const onData = async (key: string) => {
      if (searchMode) {
        if (key === ESCAPE || key === CTRL_C) {
          searchMode = false;
          searchQuery = "";
          renderMenu();
        } else if (key === BACKSPACE || key === BACKSPACE2) {
          searchQuery = searchQuery.slice(0, -1);
          renderMenu();
        } else if (key === ENTER || key === ENTER_LF) {
          searchMode = false;
          if (searchQuery.length > 0) {
            process.stdout.write("\x1b[2J\x1b[H  Searching...\n");
            searchResults = await deepSearch(rootDir, searchQuery);
            await buildEntries();
          }
          renderMenu();
        } else if (key.length === 1 && key >= " ") {
          searchQuery += key;
          renderMenu();
        }
        return;
      }

      if (key === CURSOR_UP && entries.length > 0) {
        selectedIndex = (selectedIndex - 1 + entries.length) % entries.length;
        renderMenu();
      } else if (key === CURSOR_DOWN && entries.length > 0) {
        selectedIndex = (selectedIndex + 1) % entries.length;
        renderMenu();
      } else if ((key === ENTER || key === ENTER_LF) && entries.length > 0) {
        const entry = entries[selectedIndex];
        if (entry.type === "parent") {
          currentDir = dirname(currentDir);
          searchResults = null;
          searchQuery = "";
          await buildEntries();
          renderMenu();
        } else if (entry.type === "dir") {
          currentDir = join(currentDir, entry.name);
          searchResults = null;
          searchQuery = "";
          await buildEntries();
          renderMenu();
        } else {
          cleanup();
          const selected = searchResults !== null
            ? resolve(rootDir, entry.relPath || entry.name)
            : resolve(currentDir, entry.name);
          process.stdout.write("\x1b[2J\x1b[H");
          resolvePromise(selected);
        }
      } else if (key === "/") {
        searchMode = true;
        searchQuery = "";
        searchResults = null;
        renderMenu();
      } else if (key === ESCAPE) {
        if (searchResults !== null) {
          searchResults = null;
          searchQuery = "";
          await buildEntries();
          renderMenu();
        } else if (currentDir !== rootDir) {
          currentDir = dirname(currentDir);
          await buildEntries();
          renderMenu();
        } else {
          cleanup();
          process.stdout.write("\x1b[2J\x1b[H");
          resolvePromise(null);
        }
      } else if (key === "c" || key === "q" || key === CTRL_C) {
        cleanup();
        process.stdout.write("\x1b[2J\x1b[H");
        resolvePromise(null);
      } else if (key === "-" || key === "h" || key === "\x1b[D") { // left arrow or - or h to go back
        if (searchResults !== null) {
          searchResults = null;
          searchQuery = "";
          await buildEntries();
          renderMenu();
        } else if (currentDir !== rootDir) {
          currentDir = dirname(currentDir);
          await buildEntries();
          renderMenu();
        }
      } else if ((key === "l" || key === "\x1b[C") && entries.length > 0) { // right arrow or l to enter
        const entry = entries[selectedIndex];
        if (entry.type === "parent") {
          currentDir = dirname(currentDir);
          searchResults = null;
          await buildEntries();
          renderMenu();
        } else if (entry.type === "dir") {
          currentDir = join(currentDir, entry.name);
          searchResults = null;
          await buildEntries();
          renderMenu();
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

/**
 * Returns the SHA-256 hex hash of the given buffer using Bun's crypto.
 */
export async function computeHash(buffer: Uint8Array): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buffer);
  return hasher.digest("hex");
}
