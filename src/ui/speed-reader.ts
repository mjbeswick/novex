import type { Word, Theme } from "../types";
import { ANSI, clearScreen, getTerminalSize, moveTo } from "./terminal";
import { themes, type ColorTheme } from "./themes";

export interface SpeedReaderState {
  words: Word[][];  // chunks
  currentChunk: number;
  wpm: number;
  chunkSize: number;
  paused: boolean;
  theme: Theme;
  /** Full plain text — used to extract sentence context */
  text: string;
  /** Flat word array (same words as chunks, unflattened) */
  allWords: Word[];
  /** Optional: current chapter index */
  chapterIndex?: number;
  /** Optional: current paragraph index within chapter */
  paraIndexInChapter?: number;
  /** Optional: current word index within paragraph */
  wordIndexInPara?: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────


function centerPad(str: string, width: number): string {
  const visible = stripAnsi(str).length;
  if (visible >= width) return str;
  const pad = Math.floor((width - visible) / 2);
  return " ".repeat(pad) + str + " ".repeat(width - visible - pad);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Spritz Optimal Recognition Point:
 * the letter your eye should fixate on for fastest recognition.
 * 1 char → index 0 | 2–5 → 1 | 6–9 → 2 | 10–13 → 3 | 14+ → 4
 */
function orpIndex(word: string): number {
  const n = word.replace(/[^a-zA-Z0-9]/g, "").length || word.length;
  if (n <= 1) return 0;
  if (n <= 5) return 1;
  if (n <= 9) return 2;
  if (n <= 13) return 3;
  return 4;
}

// ── Sentence context helpers ───────────────────────────────────────────────────

interface Sentence {
  text: string;
  start: number; // char offset in full text
  end: number;
}

function splitSentences(text: string): Sentence[] {
  const result: Sentence[] = [];
  const re = /[.!?]+(?:\s+|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    result.push({ text: text.slice(last, end).trim(), start: last, end });
    last = end;
  }
  if (last < text.length) {
    result.push({ text: text.slice(last).trim(), start: last, end: text.length });
  }
  return result;
}

interface TrackedLine {
  text: string;
  tokens: { word: string; srcOffset: number; lineOffset: number }[];
}

function wrapWordsTracked(text: string, width: number): TrackedLine[] {
  const re = /\S+/g;
  const allTokens: { word: string; srcOffset: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    allTokens.push({ word: m[0], srcOffset: m.index });
  }

  const lines: TrackedLine[] = [];
  let curTokens: typeof allTokens = [];

  const flush = () => {
    if (curTokens.length === 0) return;
    let lineOffset = 0;
    const tokens = curTokens.map(tk => {
      const entry = { word: tk.word, srcOffset: tk.srcOffset, lineOffset };
      lineOffset += tk.word.length + 1;
      return entry;
    });
    lines.push({ text: curTokens.map(tk => tk.word).join(" "), tokens });
    curTokens = [];
  };

  for (const token of allTokens) {
    if (curTokens.length === 0) {
      curTokens = [token];
    } else {
      const curLen = curTokens.reduce((n, tk) => n + tk.word.length, 0) + (curTokens.length - 1);
      if (curLen + 1 + token.word.length <= width) {
        curTokens.push(token);
      } else {
        flush();
        curTokens = [token];
      }
    }
  }
  flush();
  return lines;
}

/**
 * Returns up to 3 ANSI-coloured lines of the sentence containing `currentWord`,
 * with the current word highlighted in yellow.
 */
function buildSentenceLines(
  fullText: string,
  currentWord: Word,
  boxWidth: number,
  t: ColorTheme
): { lines: string[]; sentenceText: string; highlightLine: number } {
  const sentences = splitSentences(fullText);
  const charOff = currentWord.charOffset;
  const sentence = sentences.find((s) => charOff >= s.start && charOff < s.end);
  if (!sentence) return { lines: [], sentenceText: "", highlightLine: -1 };

  // Compute the word's offset within sentence.text (which is trimmed from the raw slice)
  const rawSlice = fullText.slice(sentence.start, sentence.end);
  const leadingStripped = rawSlice.length - rawSlice.trimStart().length;
  const wordOffsetInSentence = (charOff - sentence.start) - leadingStripped;

  const wrappedLines = wrapWordsTracked(sentence.text, boxWidth);
  const wordText = currentWord.text;
  let highlightLine = -1;

  const lines = wrappedLines.slice(0, 3).map(({ text: line, tokens }, i) => {
    if (highlightLine === -1) {
      const tok = tokens.find(tk => tk.srcOffset === wordOffsetInSentence);
      if (tok) {
        highlightLine = i;
        const idx = tok.lineOffset;
        return (
          t.dim + line.slice(0, idx) + ANSI.reset +
          "\x1b[4m" + line.slice(idx, idx + wordText.length) + ANSI.reset +
          t.dim + line.slice(idx + wordText.length) + ANSI.reset
        );
      }
    }
    return t.dim + line + ANSI.reset;
  });

  return { lines, sentenceText: sentence.text, highlightLine };
}

// ── SpeedReader ────────────────────────────────────────────────────────────────

export class SpeedReader {
  private state: SpeedReaderState;
  private initialized = false;
  private lastSentenceText = "";
  private lastHeaderText = "";
  private lastFooterText = "";
  private lastHighlightLine = -1;
  private lastSize = { cols: 0, rows: 0 };

  constructor(state: SpeedReaderState) {
    this.state = { ...state };
  }

  updateState(state: Partial<SpeedReaderState>): void {
    this.state = { ...this.state, ...state };
  }

  /** Call when leaving speed reader so the next entry does a full redraw. */
  reset(): void {
    this.initialized = false;
    this.lastSentenceText = "";
    this.lastHeaderText = "";
    this.lastFooterText = "";
    this.lastHighlightLine = -1;
    this.lastSize = { cols: 0, rows: 0 };
  }

  getCurrentChunkText(): string {
    const { words, currentChunk } = this.state;
    const chunk = words[currentChunk];
    if (!chunk || chunk.length === 0) return "";
    return chunk.map((w) => w.text).join(" ");
  }

  getProgress(): number {
    const { words, currentChunk } = this.state;
    if (words.length <= 1) return 100;
    return Math.round((currentChunk / (words.length - 1)) * 100);
  }

  render(): void {
    const { cols, rows } = getTerminalSize();
    const sizeChanged = cols !== this.lastSize.cols || rows !== this.lastSize.rows;

    if (!this.initialized || sizeChanged) {
      this.lastSize = { cols, rows };
      this.initialized = true;
      this.lastSentenceText = "";
      this._fullRender(cols, rows);
    } else {
      this._partialRender(cols, rows);
    }
  }

  private _buildHeaderText(progress: number): string {
    const { wpm, chunkSize, paused } = this.state;
    const ttsFlag = (this.state as SpeedReaderState & { tts?: boolean }).tts ? "  🔊" : "";
    return `${progress}%  WPM: ${wpm}  Chunk: ${chunkSize}${ttsFlag}  ${paused ? "■ PAUSED" : "▶"}`;
  }

  private _buildFooterText(): string {
    const { words, currentChunk, theme, chapterIndex, paraIndexInChapter, wordIndexInPara, allWords } = this.state;
    const t = themes[theme];

    // Get current word text
    const chunk = words[currentChunk];
    const currentWord = chunk && chunk.length > 0 ? chunk[0].text : "";
    const currentWordIndex = chunk && chunk.length > 0 ? chunk[0].index : 0;

    // Build hierarchical index with styling (matching page view - bright accent color, no brackets)
    let indexPath = "";
    if (chapterIndex !== undefined && paraIndexInChapter !== undefined && currentWord) {
      // Use relative index if available, otherwise fall back to absolute index (matching page view)
      const wordIdx = wordIndexInPara ?? currentWordIndex;
      // Format: escape dim → apply accent+bold → index → reset to dim → continue
      const indexContent = `ch ${chapterIndex}/para ${paraIndexInChapter + 1}/word ${wordIdx}`;
      indexPath = ` ${ANSI.reset}${t.accent}${ANSI.bold}${indexContent}${ANSI.reset}`;
    }

    // Show word with index, then shortcuts
    const wordInfo = currentWord ? `"${currentWord}"${indexPath}` : "";
    const shortcuts = `[space] pause  [→][←] skip  [↑][↓] sentence  [+][-] wpm  [[]]] chunk  [q] back`;

    return wordInfo ? `${wordInfo} · ${shortcuts}` : shortcuts;
  }

  private _writeHeader(headerText: string, spritzRow: number, cols: number, t: ColorTheme): void {
    if (headerText === this.lastHeaderText) return;
    this.lastHeaderText = headerText;
    moveTo(spritzRow - 2, 1);
    process.stdout.write(t.dim + centerPad(headerText, cols) + ANSI.reset);
  }

  private _writeFooter(footerText: string, rows: number, cols: number, t: ColorTheme): void {
    if (footerText === this.lastFooterText) return;
    this.lastFooterText = footerText;
    moveTo(rows - 2, 1);
    process.stdout.write(t.dim + centerPad(footerText, cols) + ANSI.reset);
  }

  private _layout(cols: number, rows: number) {
    const spritzRow = Math.max(6, Math.floor(rows * 0.35));
    const boxWidth = Math.min(cols - 8, 60);
    const boxStartCol = Math.floor((cols - boxWidth) / 2);
    const orpCol = boxStartCol + Math.floor(boxWidth * 0.4);
    return { spritzRow, boxWidth, boxStartCol, orpCol };
  }

  private _buildWordLine(word: string, orp: number, wordStart: number, t: ColorTheme, cols: number): string {
    const before  = word.slice(0, orp);
    const orpChar = word[orp] ?? "";
    const after   = word.slice(orp + 1);
    const raw =
      " ".repeat(Math.max(0, wordStart)) +
      t.text + before +
      "\x1b[31m" + ANSI.bold + orpChar + ANSI.reset +
      t.text + after + ANSI.reset;
    // Pad to full width to erase previous (possibly longer) word
    const visLen = Math.max(0, wordStart) + word.length;
    return raw + " ".repeat(Math.max(0, cols - visLen));
  }

  private _fullRender(cols: number, rows: number): void {
    const { wpm, chunkSize, paused, theme, words, currentChunk, text, allWords } = this.state;
    const t = themes[theme];
    const { spritzRow, boxWidth, boxStartCol, orpCol } = this._layout(cols, rows);

    clearScreen();

    const chunk = words[currentChunk];
    const word = chunk && chunk.length > 0 ? chunk[0].text : "";
    const currentWordObj = chunk && chunk.length > 0 ? allWords.find(w => w.index === chunk[0].index) ?? chunk[0] : null;
    const progress = this.getProgress();
    const orp = orpIndex(word);
    const wordStart = orpCol - orp;

    const leftDash  = "─".repeat(orpCol - boxStartCol);
    const rightDash = "─".repeat(boxWidth - leftDash.length - 1);
    const makeBorder = (notch: string) =>
      " ".repeat(boxStartCol) + t.border + leftDash + t.accent + notch + t.border + rightDash + ANSI.reset;
    const tickLine = " ".repeat(orpCol) + t.accent + "│" + ANSI.reset;

    this._writeHeader(this._buildHeaderText(progress), spritzRow, cols, t);

    moveTo(spritzRow, 1);     process.stdout.write(tickLine);
    moveTo(spritzRow + 1, 1); process.stdout.write(makeBorder("┬"));
    moveTo(spritzRow + 2, 1); process.stdout.write(this._buildWordLine(word, orp, wordStart, t, cols));
    moveTo(spritzRow + 3, 1); process.stdout.write(makeBorder("┴"));
    moveTo(spritzRow + 4, 1); process.stdout.write(tickLine);

    this._writeFooter(this._buildFooterText(), rows, cols, t);
  }

  private _partialRender(cols: number, rows: number): void {
    const { theme, words, currentChunk, text, allWords } = this.state;
    const t = themes[theme];
    const { spritzRow, boxWidth, orpCol } = this._layout(cols, rows);

    const chunk = words[currentChunk];
    const word = chunk && chunk.length > 0 ? chunk[0].text : "";
    const currentWordObj = chunk && chunk.length > 0 ? allWords.find(w => w.index === chunk[0].index) ?? chunk[0] : null;
    const orp = orpIndex(word);
    const wordStart = orpCol - orp;

    // Update word line
    moveTo(spritzRow + 2, 1);
    process.stdout.write(this._buildWordLine(word, orp, wordStart, t, cols));

    // Update header and footer
    this._writeHeader(this._buildHeaderText(this.getProgress()), spritzRow, cols, t);
    this._writeFooter(this._buildFooterText(), rows, cols, t);
  }

  handleKey(
    key: string
  ):
    | "pause"
    | "next"
    | "prev"
    | "skip-sentence-fwd"
    | "skip-sentence-back"
    | "wpm-up"
    | "wpm-down"
    | "chunk-up"
    | "chunk-down"
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
      case "+":
      case "=":
        return "wpm-up";
      case "-":
        return "wpm-down";
      case "]":
        return "chunk-up";
      case "[":
        return "chunk-down";
      case "q":
        return "quit";
      default:
        return null;
    }
  }
}
