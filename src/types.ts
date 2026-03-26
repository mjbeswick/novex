// Shared type definitions for lekto-cli

export type ReadingMode = "page" | "scroll" | "speed";
export type Theme = "light" | "dark";

export interface CLIOptions {
  mode: ReadingMode;
  wpm: number;
  chunk: number;
  theme: Theme;
  lineWidth?: number;
  position?: string;
  noSave: boolean;
  tts: boolean;
}

export interface ParsedContent {
  /** Raw HTML representation of the document */
  html: string;
  /** Plain text extracted for speed/RSVP modes */
  text: string;
  /** Ordered list of chapters/sections */
  chapters: Chapter[];
  /** Document title */
  title: string;
  /** Original file path or 'stdin' */
  source: string;
  /** SHA-256 hash of source content for state keying */
  hash: string;
}

export interface Chapter {
  title: string;
  /** HTML content of this chapter */
  html: string;
  /** Plain text content */
  text: string;
  /** Index within the document */
  index: number;
}

export interface Page {
  /** Lines of rendered text */
  lines: string[];
  chapterIndex: number;
  pageIndexInChapter: number;
  globalPageIndex: number;
}

export interface Word {
  text: string;
  /** Index within the full word array */
  index: number;
  /** Character offset in plain text */
  charOffset: number;
}

// Position types
export type Position =
  | { type: "page"; page: number }
  | { type: "scroll"; offset: number }
  | { type: "word"; index: number };

export function positionToString(pos: Position): string {
  if (pos.type === "page") return `page:${pos.page}`;
  if (pos.type === "scroll") return `scroll:${pos.offset}`;
  return `word:${pos.index}`;
}

export function parsePosition(str: string): Position {
  const [type, value] = str.split(":");
  if (type === "page") return { type: "page", page: parseInt(value, 10) };
  if (type === "scroll") return { type: "scroll", offset: parseInt(value, 10) };
  if (type === "word") return { type: "word", index: parseInt(value, 10) };
  return { type: "page", page: 0 };
}

// State / persistence types
export interface Bookmark {
  position: string;
  note: string;
  timestamp: string;
}

export interface FileState {
  bookmarks: Bookmark[];
  lastPosition: string;
  lastRead: string;
  source: string;
  title: string;
}

export interface HistoryStore {
  [fileHash: string]: FileState;
}

// Format detection
export type ContentFormat = "epub" | "docx" | "fb2" | "markdown" | "text" | "html";

// Terminal dimensions
export interface TerminalSize {
  cols: number;
  rows: number;
}

// Rendering context shared across views
export interface RenderContext {
  size: TerminalSize;
  theme: Theme;
  lineWidth: number;
}
