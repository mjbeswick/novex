import { resolve } from "node:path";
import { createHash } from "node:crypto";

/** Reading extensions that the interactive browser will list */
const READING_EXTENSIONS = [".epub", ".docx", ".fb2", ".md", ".txt", ".html", ".htm"];

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
 * Returns the SHA-256 hex hash of the given buffer using Bun's crypto.
 */
export async function computeHash(buffer: Uint8Array): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buffer);
  return hasher.digest("hex");
}
