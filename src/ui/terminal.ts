import type { TerminalSize } from "../types";

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  // colors (fg)
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  // bright
  brightBlack: "\x1b[90m",
  brightWhite: "\x1b[97m",
  // bg
  bgBlack: "\x1b[40m",
  bgWhite: "\x1b[107m",
} as const;

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

export function enterAltScreen(): void {
  process.stdout.write("\x1b[?1049h");
}

export function exitAltScreen(): void {
  process.stdout.write("\x1b[?1049l");
}

export function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

export function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

export function moveTo(row: number, col: number): void {
  // ANSI sequences are 1-based
  process.stdout.write(`\x1b[${row};${col}H`);
}

export function clearLine(): void {
  process.stdout.write("\x1b[2K");
}

export function getTerminalSize(): TerminalSize {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  return { cols, rows };
}

export function enableMouseTracking(): void {
  process.stdout.write("\x1b[?1000h\x1b[?1006h");
}

export function disableMouseTracking(): void {
  process.stdout.write("\x1b[?1000l\x1b[?1006l");
}

// ── Raw mode ──────────────────────────────────────────────────────────────────

export function enableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("binary");
}

export function disableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}

// ── Key reading ───────────────────────────────────────────────────────────────

/**
 * Read a single keypress from stdin (raw mode must be active).
 * Returns a normalised key name or the raw character for printable keys.
 *
 * Named keys: 'up' | 'down' | 'left' | 'right'
 *             'shift+right' | 'shift+left' | 'shift+up' | 'shift+down'
 *             'enter' | 'space' | 'escape' | 'backspace' | 'q' | …
 */
export async function readKey(): Promise<string> {
  while (true) {
    const key = await readOnce();
    if (key !== "_ignore") return key;
  }
}

async function readOnce(): Promise<string> {
  return new Promise((resolve, _reject) => {
    const onData = (data: Buffer | string) => {
      process.stdin.removeListener("data", onData);
      const raw = typeof data === "string" ? data : data.toString("binary");
      if (raw === "\x03") {
        showCursor();
        disableRawMode();
        exitAltScreen();
        process.exit(0);
      }
      resolve(decodeKey(raw));
    };
    process.stdin.once("data", onData);
  });
}

function decodeKey(raw: string): string {
  // Enter
  if (raw === "\r" || raw === "\n") return "enter";
  // Space
  if (raw === " ") return "space";
  // Backspace
  if (raw === "\x7f" || raw === "\x08") return "backspace";
  // Escape (lone ESC, not a sequence)
  if (raw === "\x1b") return "escape";

  // ESC sequences
  if (raw.startsWith("\x1b[")) {
    const seq = raw.slice(2);

    // Shift+arrow sequences (CSI 1;2X)
    if (seq === "1;2A") return "shift+up";
    if (seq === "1;2B") return "shift+down";
    if (seq === "1;2C") return "shift+right";
    if (seq === "1;2D") return "shift+left";

    // Standard arrows
    if (seq === "A") return "up";
    if (seq === "B") return "down";
    if (seq === "C") return "right";
    if (seq === "D") return "left";

    // Page up / Page down
    if (seq === "5~") return "pageup";
    if (seq === "6~") return "pagedown";

    // Home / End
    if (seq === "H" || seq === "1~") return "home";
    if (seq === "F" || seq === "4~") return "end";

    // Delete
    if (seq === "3~") return "delete";

    // SGR mouse: \x1b[<button;col;rowM (press) or m (release)
    if (seq.startsWith("<")) {
      const m = /^<(\d+);(\d+);(\d+)([Mm])$/.exec(raw.slice(2));
      if (m) {
        const btn = parseInt(m[1]);
        const col = parseInt(m[2]);
        const row = parseInt(m[3]);
        const press = m[4] === "M";
        if (press && btn === 0) return `mouse:${row}:${col}`;
        return "_ignore";
      }
    }

    return `esc[${seq}]`;
  }

  // ESC O sequences (SS3 – numpad arrows on some terminals)
  if (raw.startsWith("\x1bO")) {
    const ch = raw[2];
    if (ch === "A") return "up";
    if (ch === "B") return "down";
    if (ch === "C") return "right";
    if (ch === "D") return "left";
  }

  // Printable ASCII
  if (raw.length === 1) {
    const code = raw.charCodeAt(0);
    if (code >= 32 && code <= 126) return raw;
  }

  return `unknown(${Buffer.from(raw, "binary").toString("hex")})`;
}
