import type { ParsedContent, CLIOptions, ReadingMode, Position } from "./types.ts";
import { parsePosition, positionToString } from "./types.ts";
import { buildPages, chunkWords } from "./pagination.ts";
import { extractWords } from "./normalizer.ts";
import { addBookmark, deleteBookmark, getFileState, updateLastPosition } from "./store.ts";
import {
  hideCursor,
  showCursor,
  enableRawMode,
  disableRawMode,
  readKey,
  getTerminalSize,
  clearScreen,
  enterAltScreen,
  exitAltScreen,
  enableMouseTracking,
  disableMouseTracking,
} from "./ui/index.ts";
import {
  PageView,
  ScrollView,
  SpeedReader,
  showHelp,
  showBookmarks,
  showToc,
  searchContent,
  SearchBar,
  SPREAD_MIN_COLS,
} from "./ui/index.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function wpmToMs(wpm: number): number {
  return Math.round(60000 / wpm);
}

/** Returns the usable content width per column, accounting for spread layout. */
function contentCols(cols: number): number {
  if (cols >= SPREAD_MIN_COLS) return Math.floor((cols - 3) / 2);
  return cols;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Approximate sentence boundary skip: advance/rewind by ~10 words.
 */
const SENTENCE_SKIP = 10;

// ── TTS ───────────────────────────────────────────────────────────────────────

interface TtsHandle {
  proc: ReturnType<typeof Bun.spawn> | null;
  sentence: string;
}

function createTts(): TtsHandle {
  return { proc: null, sentence: "" };
}

function ttsSpeak(handle: TtsHandle, sentence: string, wpm: number): void {
  if (sentence === handle.sentence) return; // same sentence already playing
  handle.sentence = sentence;
  if (handle.proc) {
    try { handle.proc.kill(); } catch { /* ignore */ }
    handle.proc = null;
  }
  if (!sentence) return;

  // Clamp wpm to sensible TTS rate (say uses words/min, espeak uses words/min too)
  const rate = Math.min(Math.max(wpm, 80), 500);
  const safeText = sentence.replace(/"/g, "'");

  try {
    if (process.platform === "darwin") {
      handle.proc = Bun.spawn(["say", "-r", String(rate), safeText], {
        stdout: "ignore", stderr: "ignore",
      });
    } else {
      // Linux fallback: espeak
      handle.proc = Bun.spawn(["espeak", `--speed=${rate}`, safeText], {
        stdout: "ignore", stderr: "ignore",
      });
    }
  } catch {
    handle.proc = null;
  }
}

function ttsStop(handle: TtsHandle): void {
  if (handle.proc) {
    try { handle.proc.kill(); } catch { /* ignore */ }
    handle.proc = null;
  }
  handle.sentence = "";
}

/** Split text into sentences and return the one containing charOffset */
function sentenceAt(text: string, charOffset: number): string {
  const re = /[.!?]+(?:\s+|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (charOffset >= last && charOffset < end) return text.slice(last, end).trim();
    last = end;
  }
  return text.slice(last).trim();
}

/**
 * Race a timer (ms) against a keypress. Resolves with 'tick' or the key string.
 */
async function raceTickKey(ms: number): Promise<{ type: "tick" } | { type: "key"; key: string }> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.stdin.removeListener("data", onData);
      resolve({ type: "tick" });
    }, ms);

    const onData = (data: Buffer | string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);

      const raw = typeof data === "string" ? data : data.toString("binary");

      // Ctrl+C
      if (raw === "\x03") {
        showCursor();
        disableRawMode();
        process.exit(0);
      }

      // Decode the key using the same mapping as terminal.ts readKey
      const key = decodeRawKey(raw);
      resolve({ type: "key", key });
    };

    process.stdin.once("data", onData);
  });
}

function decodeRawKey(raw: string): string {
  if (raw === "\r" || raw === "\n") return "enter";
  if (raw === " ") return "space";
  if (raw === "\x7f" || raw === "\x08") return "backspace";
  if (raw === "\x1b") return "escape";

  if (raw.startsWith("\x1b[")) {
    const seq = raw.slice(2);
    if (seq === "1;2A") return "shift+up";
    if (seq === "1;2B") return "shift+down";
    if (seq === "1;2C") return "shift+right";
    if (seq === "1;2D") return "shift+left";
    if (seq === "A") return "up";
    if (seq === "B") return "down";
    if (seq === "C") return "right";
    if (seq === "D") return "left";
    if (seq === "5~") return "pageup";
    if (seq === "6~") return "pagedown";
    if (seq === "H" || seq === "1~") return "home";
    if (seq === "F" || seq === "4~") return "end";
    if (seq === "3~") return "delete";
    return `esc[${seq}]`;
  }

  if (raw.startsWith("\x1bO")) {
    const ch = raw[2];
    if (ch === "A") return "up";
    if (ch === "B") return "down";
    if (ch === "C") return "right";
    if (ch === "D") return "left";
  }

  if (raw.length === 1) {
    const code = raw.charCodeAt(0);
    if (code >= 32 && code <= 126) return raw;
  }

  return `unknown(${Buffer.from(raw, "binary").toString("hex")})`;
}

// ── Search helper (interactive query input) ───────────────────────────────────

async function promptSearch(theme: CLIOptions["theme"]): Promise<string> {
  const bar = new SearchBar(theme);
  let query = "";
  bar.render(query);

  while (true) {
    const key = await readKey();
    if (key === "enter") break;
    if (key === "escape") { query = ""; break; }
    if (key === "backspace") {
      query = query.slice(0, -1);
    } else if (key.length === 1) {
      query += key;
    }
    bar.render(query);
  }

  return query;
}


// ── Main session entry point ───────────────────────────────────────────────────

export async function runSession(
  content: ParsedContent,
  options: CLIOptions,
  initialPosition?: string
): Promise<void> {
  let { cols, rows } = getTerminalSize();

  // Build pages
  let pages = buildPages(content, contentCols(cols), rows, options.lineWidth, options.theme);

  // Build words for speed/rsvp
  const words = extractWords(content.text);
  const chunks = chunkWords(words, options.chunk);

  // Track terminal resize
  let resizePending = false;
  const onResize = () => { resizePending = true; };
  process.stdout.on("resize", onResize);

  // Parse initial position
  let startPage = 0;
  let startWord = 0;
  let startScroll = 0;

  if (initialPosition) {
    const pos = parsePosition(initialPosition);
    if (pos.type === "page") startPage = clamp(pos.page, 0, pages.length - 1);
    else if (pos.type === "word") startWord = clamp(pos.index, 0, Math.max(0, words.length - 1));
    else if (pos.type === "scroll") startScroll = pos.offset;
  }

  // Current state shared across mode switches
  let currentMode: ReadingMode = options.mode;
  let currentPage = startPage;
  let currentWord = startWord;
  let currentScroll = startScroll;

  // Flatten all page lines for scroll view
  let allLines: string[] = pages.flatMap((p) => p.lines);

  enterAltScreen();
  hideCursor();
  enableRawMode();

  try {
    let running = true;

    while (running) {
      // Rebuild pages if the terminal was resized
      if (resizePending) {
        resizePending = false;
        ({ cols, rows } = getTerminalSize());
        pages = buildPages(content, contentCols(cols), rows, options.lineWidth, options.theme);
        allLines = pages.flatMap((p) => p.lines);
      }

      switch (currentMode) {
        case "page":
          currentPage = await runPageMode(
            content, options, pages, currentPage,
            (newMode) => { currentMode = newMode; },
            () => { running = false; },
            words,
            chunks,
            (idx) => { currentWord = idx; },
            () => resizePending,
            currentWord,
            words
          );
          break;

        case "scroll":
          currentScroll = await runScrollMode(
            content, options, allLines, currentScroll,
            (newMode) => { currentMode = newMode; },
            () => { running = false; },
            () => resizePending
          );
          break;

        case "speed":
          currentWord = await runSpeedMode(
            content, options, chunks, words, currentWord,
            (newMode) => { currentMode = newMode; },
            () => { running = false; },
            () => resizePending
          );
          break;

        default:
          running = false;
      }
    }

    // Save final position on quit
    if (!options.noSave) {
      let finalPos: Position;
      if (currentMode === "scroll") {
        finalPos = { type: "scroll", offset: currentScroll };
      } else if (currentMode === "speed") {
        finalPos = { type: "word", index: currentWord };
      } else {
        finalPos = { type: "page", page: currentPage };
      }
      await updateLastPosition(content.hash, positionToString(finalPos), content.source, content.title).catch(() => {});
    }
  } finally {
    process.stdout.off("resize", onResize);
    showCursor();
    disableRawMode();
    exitAltScreen();
  }
}

// ── Page mode helpers ─────────────────────────────────────────────────────────

interface SelectionState {
  pageIndex: number;
  paraStart: number;
  paraEnd: number;
  wordText: string | null;
  wordIndex: number | null;  // index in allWords
  wordLine: number | null;
  wordColStart: number | null;
  wordColEnd: number | null;
}

function getParagraphGroups(lines: string[]): {start: number, end: number}[] {
  const groups: {start: number, end: number}[] = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const blank = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim().length === 0;
    if (!blank && start === -1) start = i;
    else if (blank && start !== -1) { groups.push({start, end: i - 1}); start = -1; }
  }
  if (start !== -1) groups.push({start, end: lines.length - 1});
  return groups;
}

function wordAtColumn(ansiLine: string, col: number): {text: string, start: number, end: number} | null {
  const stripped = ansiLine.replace(/\x1b\[[0-9;]*m/g, "");
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (col >= m.index && col < m.index + m[0].length) {
      return {text: m[0], start: m.index, end: m.index + m[0].length - 1};
    }
  }
  return null;
}

function findWordApprox(
  text: string,
  allWords: ReturnType<typeof extractWords>,
  currentPage: number,
  totalPages: number
): ReturnType<typeof extractWords>[number] | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(text);
  if (!n) return null;
  const approx = Math.round(currentPage / Math.max(totalPages - 1, 1) * (allWords.length - 1));
  const win = Math.max(200, Math.round(allWords.length / Math.max(totalPages, 1)) * 3);
  const lo = Math.max(0, approx - win);
  const hi = Math.min(allWords.length - 1, approx + win);
  for (let i = approx; i <= hi; i++) if (norm(allWords[i]!.text) === n) return allWords[i]!;
  for (let i = approx - 1; i >= lo; i--) if (norm(allWords[i]!.text) === n) return allWords[i]!;
  return null;
}

/**
 * Creates a SelectionState for a word at the given index.
 * Finds the word's position on the page and returns proper selection info.
 */
function createSelectionFromWordIndex(
  wordIdx: number,
  allWords: ReturnType<typeof extractWords>,
  pages: ReturnType<typeof buildPages>
): SelectionState | null {
  const word = allWords[wordIdx];
  if (!word) return null;

  // Find which page this word appears on (approximate by word distribution)
  let targetPageIdx = 0;
  if (pages.length > 1) {
    targetPageIdx = Math.round((wordIdx / allWords.length) * (pages.length - 1));
    targetPageIdx = Math.max(0, Math.min(targetPageIdx, pages.length - 1));
  }

  // Search nearby pages for the word
  for (let offset = 0; offset < pages.length; offset++) {
    const pageIdx = targetPageIdx + (offset % 2 === 0 ? offset / 2 : -Math.ceil(offset / 2));
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const lines = page?.lines ?? [];
    const groups = getParagraphGroups(lines);

    // Search lines for this word
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const ansiLine = lines[lineIdx];
      const stripped = ansiLine.replace(/\x1b\[[0-9;]*m/g, "");
      const re = /\S+/g;
      let m: RegExpExecArray | null;

      while ((m = re.exec(stripped)) !== null) {
        if (m[0].toLowerCase() === word.text.toLowerCase()) {
          // Found matching word, create selection
          let para = groups.find(g => lineIdx >= g.start && lineIdx <= g.end);
          if (!para) para = { start: lineIdx, end: lineIdx };

          return {
            pageIndex: pageIdx,
            paraStart: para.start,
            paraEnd: para.end,
            wordText: word.text,
            wordIndex: wordIdx,
            wordLine: lineIdx,
            wordColStart: m.index,
            wordColEnd: m.index + m[0].length - 1,
          };
        }
      }
    }
  }

  // Fallback: create selection without exact position
  return {
    pageIndex: targetPageIdx,
    paraStart: 0,
    paraEnd: 0,
    wordText: word.text,
    wordIndex: wordIdx,
    wordLine: null,
    wordColStart: null,
    wordColEnd: null,
  };
}

// ── Page mode ─────────────────────────────────────────────────────────────────

async function runPageMode(
  content: ParsedContent,
  options: CLIOptions,
  pages: ReturnType<typeof buildPages>,
  startPage: number,
  switchMode: (m: ReadingMode) => void,
  quit: () => void,
  allWords: ReturnType<typeof extractWords>,
  _chunks: ReturnType<typeof chunkWords>,
  setCurrentWord: (idx: number) => void,
  isResizePending: () => boolean,
  initialWordIndex: number | null = null,
  allWordsForSelection: ReturnType<typeof extractWords> = allWords
): Promise<number> {
  let currentPage = startPage;

  // If returning from speed mode, create selection from the word that was being read
  let selection: SelectionState | null = null;
  if (initialWordIndex !== null) {
    selection = createSelectionFromWordIndex(initialWordIndex, allWordsForSelection, pages);
    if (selection) {
      currentPage = clamp(selection.pageIndex, 0, pages.length - 1);
    }
  }

  // Load bookmarks once; keep a local mirror for quick access
  const initState = await getFileState(content.hash).catch(() => null);
  let localBookmarks: import("./types.ts").Bookmark[] = initState?.bookmarks ?? [];

  const getChapterTitle = () => {
    const page = pages[currentPage];
    if (!page) return content.title;
    return content.chapters[page.chapterIndex]?.title ?? content.title;
  };

  /** Return 0-based line indices within pageIdx that carry a bookmark marker. */
  function getBookmarkedLines(pageIdx: number): number[] {
    const set = new Set<number>();
    const pageLines = pages[pageIdx]?.lines ?? [];
    for (const bm of localBookmarks) {
      const pos = parsePosition(bm.position);
      if (pos.type === "page" && pos.page === pageIdx) {
        set.add(0);
      } else if (pos.type === "word") {
        const approxPage = Math.round(pos.index / Math.max(allWords.length - 1, 1) * (pages.length - 1));
        if (Math.abs(approxPage - pageIdx) <= 1) {
          const word = allWords[pos.index];
          if (word) {
            const escaped = word.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$|[.,;!?:])`, "i");
            let found = false;
            for (let li = 0; li < pageLines.length; li++) {
              if (re.test((pageLines[li] ?? "").replace(/\x1b\[[0-9;]*m/g, ""))) {
                set.add(li); found = true; break;
              }
            }
            if (!found && approxPage === pageIdx) set.add(0);
          }
        }
      }
    }
    return [...set];
  }

  function bookmarkLineState() {
    const isSpread = getTerminalSize().cols >= SPREAD_MIN_COLS;
    return {
      bookmarkedLines: getBookmarkedLines(currentPage),
      bookmarkedLinesRight: isSpread ? getBookmarkedLines(currentPage + 1) : [] as number[],
    };
  }

  function checkIsBookmarked(sel: SelectionState | null): boolean {
    let pos: string;
    if (sel?.wordText) {
      pos = positionToString({ type: "word", index: sel.wordIndex ?? 0 });
    } else if (sel) {
      pos = positionToString({ type: "page", page: sel.pageIndex });
    } else {
      pos = positionToString({ type: "page", page: currentPage });
    }
    return localBookmarks.some(bm => bm.position === pos);
  }

  const view = new PageView({
    pages,
    currentPage,
    theme: options.theme,
    lineWidth: options.lineWidth,
    bookmarkCount: localBookmarks.length,
    chapterTitle: getChapterTitle(),
    title: content.title,
    selection,
    isBookmarked: checkIsBookmarked(selection),
    images: content.images,
    ...bookmarkLineState(),
  });

  enableMouseTracking();
  view.render();

  try {
    while (true) {
      if (isResizePending()) return currentPage;
      const key = await readKey();
      const action = view.handleKey(key);

      if (action === "next") {
        // In spread mode advance by 2 and snap to even pages; single mode by 1
        const step = getTerminalSize().cols >= SPREAD_MIN_COLS ? 2 : 1;
        const max  = getTerminalSize().cols >= SPREAD_MIN_COLS
          ? Math.max(0, pages.length - 2)   // last valid left-page in spread
          : pages.length - 1;
        currentPage = clamp(currentPage + step, 0, max);
        if (getTerminalSize().cols >= SPREAD_MIN_COLS) currentPage -= currentPage % 2; // snap even
        selection = null;
        view.updateState({ currentPage, chapterTitle: getChapterTitle(), selection: null, isBookmarked: checkIsBookmarked(null), ...bookmarkLineState() });
        view.render();
        if (!options.noSave) {
          updateLastPosition(content.hash, positionToString({ type: "page", page: currentPage })).catch(() => {});
        }
      } else if (action === "prev") {
        const step = getTerminalSize().cols >= SPREAD_MIN_COLS ? 2 : 1;
        currentPage = clamp(currentPage - step, 0, pages.length - 1);
        if (getTerminalSize().cols >= SPREAD_MIN_COLS) currentPage -= currentPage % 2;
        selection = null;
        view.updateState({ currentPage, chapterTitle: getChapterTitle(), selection: null, isBookmarked: checkIsBookmarked(null), ...bookmarkLineState() });
        view.render();
        if (!options.noSave) {
          updateLastPosition(content.hash, positionToString({ type: "page", page: currentPage })).catch(() => {});
        }
      } else if (action === "bookmark") {
        let pos: string;
        let note = "";
        if (selection?.wordText) {
          pos = positionToString({ type: "word", index: selection.wordIndex ?? 0 });
          note = `"${selection.wordText}"`;
        } else if (selection) {
          pos = positionToString({ type: "page", page: selection.pageIndex });
          const firstLine = (pages[selection.pageIndex]?.lines[selection.paraStart] ?? "")
            .replace(/\x1b\[[0-9;]*m/g, "").trim();
          note = firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
        } else {
          pos = positionToString({ type: "page", page: currentPage });
        }
        const existingIdx = localBookmarks.findIndex(bm => bm.position === pos);
        if (existingIdx >= 0) {
          await deleteBookmark(content.hash, existingIdx).catch(() => {});
          localBookmarks.splice(existingIdx, 1);
        } else {
          const newBm = { position: pos, note, timestamp: new Date().toISOString() };
          await addBookmark(content.hash, newBm, content.source, content.title).catch(() => {});
          localBookmarks.push(newBm);
        }
        view.updateState({ bookmarkCount: localBookmarks.length, isBookmarked: checkIsBookmarked(selection), ...bookmarkLineState() });
        view.render();
      } else if (action === "speed") {
        if (selection?.wordIndex != null) {
          // Word is selected: start from selected word
          setCurrentWord(selection.wordIndex);
        } else if (selection != null) {
          // Paragraph selected: scan lines of the para for the first matchable word.
          // Use selection.pageIndex (not currentPage) so spread-mode right-page works.
          const selPage = pages[selection.pageIndex];
          const selLines = selPage?.lines ?? [];
          outer: for (let li = selection.paraStart; li <= Math.min(selection.paraEnd, selection.paraStart + 3); li++) {
            const stripped = (selLines[li] ?? "").replace(/\x1b\[[0-9;]*m/g, "");
            const re = /\S+/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(stripped)) !== null) {
              const found = findWordApprox(m[0], allWords, selection.pageIndex, pages.length);
              if (found) { setCurrentWord(found.index); break outer; }
            }
          }
        } else {
          // No selection: start from first word of current page
          const curPage = pages[currentPage];
          if (curPage && curPage.lines.length > 0) {
            const firstLine = curPage.lines[0];
            const stripped = firstLine.replace(/\x1b\[[0-9;]*m/g, "");
            const re = /\S+/g;
            const m = re.exec(stripped);
            if (m) {
              const found = findWordApprox(m[0], allWords, currentPage, pages.length);
              if (found) setCurrentWord(found.index);
            }
          }
        }
        switchMode("speed");
        return currentPage;
      } else if (action === "scroll") {
        switchMode("scroll");
        return currentPage;
      } else if (action === "quit") {
        quit();
        return currentPage;
      } else if (action === "help") {
        await showHelp("page", options.theme);
        view.render();
      } else if (action === "search") {
        const query = await promptSearch(options.theme);
        if (query) {
          const results = searchContent(pages, query);
          if (results.length > 0) {
            currentPage = results[0].pageIndex;
            selection = null;
            view.updateState({ currentPage, chapterTitle: getChapterTitle(), selection: null, isBookmarked: checkIsBookmarked(null), ...bookmarkLineState() });
          }
        }
        view.render();
      } else if (action === "escape") {
        selection = null;
        view.updateState({ selection: null, isBookmarked: checkIsBookmarked(null) });
        view.render();
      } else if (action === "tts") {
        if (selection?.wordIndex != null || selection?.wordText != null) {
          const idx = selection!.wordIndex;
          const charOff = idx != null ? allWords[idx]?.charOffset : null;
          if (charOff != null) {
            const ttsHandle = createTts();
            ttsSpeak(ttsHandle, sentenceAt(content.text, charOff), options.wpm);
            // Let it speak async, don't block
          }
        }
        // no-op if no selection
      } else if (action === "bookmarks") {
        const position = await showBookmarks(localBookmarks, options.theme, async (idx) => {
          await deleteBookmark(content.hash, idx).catch(() => {});
          // Reload bookmarks from store to ensure indices stay correct after deletion
          const updatedState = await getFileState(content.hash).catch(() => null);
          localBookmarks = updatedState?.bookmarks ?? [];
        });
        // Ensure we have the latest state from store
        const updatedState = await getFileState(content.hash).catch(() => null);
        localBookmarks = updatedState?.bookmarks ?? [];
        if (position) {
          const pos = parsePosition(position);
          if (pos.type === "page") {
            currentPage = clamp(pos.page, 0, pages.length - 1);
            selection = null;
            view.updateState({ currentPage, chapterTitle: getChapterTitle(), selection: null, isBookmarked: checkIsBookmarked(null), ...bookmarkLineState() });
          } else if (pos.type === "word") {
            setCurrentWord(pos.index);
            switchMode("speed");
            return currentPage;
          } else if (pos.type === "scroll") {
            switchMode("scroll");
            return currentPage;
          }
        }
        view.updateState({ bookmarkCount: localBookmarks.length, isBookmarked: checkIsBookmarked(selection), ...bookmarkLineState() });
        view.render();
      } else if (action === "image") {
        // Find image on current page and open it
        if (content.images && content.images.size > 0) {
          const pageLines = pages[currentPage]?.lines ?? [];
          // Find first image on current page
          const imageRegex = /\[Image (\d+)\]/;
          let foundImageId: string | null = null;
          for (const line of pageLines) {
            const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
            const match = stripped.match(imageRegex);
            if (match) {
              foundImageId = match[1];
              break;
            }
          }
          if (foundImageId && content.images.has(foundImageId)) {
            const imagePath = content.images.get(foundImageId)!;
            const { openImage } = await import("./ui/image-viewer.ts");
            await openImage(imagePath).catch(() => {});
            view.render();
          }
        }
      } else if (action === "toc") {
        const selectedChapterIdx = await showToc(content.chapters, pages[currentPage]?.chapterIndex ?? 0, options.theme);
        if (selectedChapterIdx !== null) {
          // Find first page of selected chapter
          const targetPage = pages.findIndex((p) => p.chapterIndex === selectedChapterIdx);
          if (targetPage !== -1) {
            currentPage = targetPage;
            selection = null;
            view.updateState({ currentPage, chapterTitle: getChapterTitle(), selection: null, isBookmarked: checkIsBookmarked(null), ...bookmarkLineState() });
          }
        }
        view.render();
      } else if (typeof action === "object" && action !== null && action.type === "click") {
        const { cols, rows } = getTerminalSize();
        const contentRows = rows - 4;
        const lineIdx = action.row - 3;  // 0-based, header=2 rows
        if (lineIdx >= 0 && lineIdx < contentRows) {
          // Determine which page and adjusted column (spread vs single)
          const isSpread = cols >= SPREAD_MIN_COLS;
          const GUTTER = 3;
          const colWidth = Math.floor((cols - GUTTER) / 2);
          let targetPageIdx = currentPage;
          let adjustedCol = action.col - 1; // 0-based
          if (isSpread) {
            if (action.col <= colWidth) {
              targetPageIdx = currentPage;
              adjustedCol = action.col - 1;
            } else if (action.col > colWidth + GUTTER) {
              targetPageIdx = currentPage + 1;
              adjustedCol = action.col - colWidth - GUTTER - 1;
            } else {
              // Gutter click — ignore
              continue;
            }
          }

          const page = pages[targetPageIdx];
          const lines = page?.lines ?? [];
          const groups = getParagraphGroups(lines);
          const para = groups.find(g => lineIdx >= g.start && lineIdx <= g.end);
          if (para) {
            const sameParaSelected = selection &&
              selection.pageIndex === targetPageIdx &&
              selection.paraStart === para.start &&
              selection.paraEnd === para.end;
            if (sameParaSelected) {
              // Second click on same paragraph: select or toggle word
              const ansiLine = lines[lineIdx] ?? "";
              const w = wordAtColumn(ansiLine, adjustedCol);
              if (w) {
                const sameWord = selection!.wordLine === lineIdx &&
                  selection!.wordColStart === w.start;
                if (sameWord) {
                  // Toggle off: go back to paragraph-only selection
                  selection = {
                    ...selection!,
                    wordText: null,
                    wordIndex: null,
                    wordLine: null,
                    wordColStart: null,
                    wordColEnd: null,
                  };
                } else {
                  const found = findWordApprox(w.text, allWords, targetPageIdx, pages.length);
                  selection = {
                    ...selection!,
                    wordText: w.text,
                    wordIndex: found?.index ?? null,
                    wordLine: lineIdx,
                    wordColStart: w.start,
                    wordColEnd: w.end,
                  };
                }
              }
            } else {
              // First click or different paragraph: select paragraph
              selection = {
                pageIndex: targetPageIdx,
                paraStart: para.start,
                paraEnd: para.end,
                wordText: null,
                wordIndex: null,
                wordLine: null,
                wordColStart: null,
                wordColEnd: null,
              };
            }
          } else {
            // Clicked outside any paragraph (blank line): deselect
            selection = null;
          }
          view.updateState({
            selection: selection ? {
              pageIndex: selection.pageIndex,
              paraStart: selection.paraStart,
              paraEnd: selection.paraEnd,
              wordLine: selection.wordLine,
              wordColStart: selection.wordColStart,
              wordColEnd: selection.wordColEnd,
              wordText: selection.wordText,
            } : null,
            isBookmarked: checkIsBookmarked(selection),
          });
          view.render();
        }
      }
      // 'command' and null — re-render or ignore
    }
  } finally {
    disableMouseTracking();
  }
}

// ── Scroll mode ────────────────────────────────────────────────────────────────

async function runScrollMode(
  content: ParsedContent,
  options: CLIOptions,
  allLines: string[],
  startOffset: number,
  switchMode: (m: ReadingMode) => void,
  quit: () => void,
  isResizePending: () => boolean
): Promise<number> {
  let offset = startOffset;
  let bookmarkCount = 0;

  const { rows } = getTerminalSize();
  const contentRows = Math.max(1, rows - 4);
  const maxOffset = Math.max(0, allLines.length - contentRows);

  const view = new ScrollView({
    lines: allLines,
    offset,
    theme: options.theme,
    lineWidth: options.lineWidth,
    bookmarkCount,
    title: content.title,
  });

  view.render();

  while (true) {
    if (isResizePending()) return offset;
    const key = await readKey();
    const action = view.handleKey(key);

    const { rows: currentRows } = getTerminalSize();
    const currentContentRows = Math.max(1, currentRows - 3);
    const currentMax = Math.max(0, allLines.length - currentContentRows);

    if (action === "scroll-down") {
      offset = clamp(offset + 1, 0, currentMax);
      view.updateState({ offset });
      view.render();
      if (!options.noSave) {
        updateLastPosition(content.hash, positionToString({ type: "scroll", offset })).catch(() => {});
      }
    } else if (action === "scroll-up") {
      offset = clamp(offset - 1, 0, currentMax);
      view.updateState({ offset });
      view.render();
      if (!options.noSave) {
        updateLastPosition(content.hash, positionToString({ type: "scroll", offset })).catch(() => {});
      }
    } else if (action === "page-down") {
      offset = clamp(offset + currentContentRows, 0, currentMax);
      view.updateState({ offset });
      view.render();
      if (!options.noSave) {
        updateLastPosition(content.hash, positionToString({ type: "scroll", offset })).catch(() => {});
      }
    } else if (action === "page-up") {
      offset = clamp(offset - currentContentRows, 0, currentMax);
      view.updateState({ offset });
      view.render();
      if (!options.noSave) {
        updateLastPosition(content.hash, positionToString({ type: "scroll", offset })).catch(() => {});
      }
    } else if (action === "bookmark") {
      await addBookmark(content.hash, {
        position: positionToString({ type: "scroll", offset }),
        note: "",
        timestamp: new Date().toISOString(),
      }, content.source, content.title).catch(() => {});
      bookmarkCount++;
      view.updateState({ bookmarkCount });
      view.render();
    } else if (action === "page-mode") {
      switchMode("page");
      return offset;
    } else if (action === "speed") {
      switchMode("speed");
      return offset;
    } else if (action === "help") {
      await showHelp("scroll", options.theme);
      view.render();
    }
  }
}

// ── Speed mode ────────────────────────────────────────────────────────────────

async function runSpeedMode(
  content: ParsedContent,
  options: CLIOptions,
  initialChunks: ReturnType<typeof chunkWords>,
  words: ReturnType<typeof extractWords>,
  startWord: number,
  switchMode: (m: ReadingMode) => void,
  quit: () => void,
  isResizePending: () => boolean
): Promise<number> {
  if (initialChunks.length === 0) {
    quit();
    return 0;
  }

  let wpm = options.wpm;
  let chunkSize = options.chunk;
  let chunks = initialChunks;

  // Convert word index to chunk index
  let currentChunk = 0;
  if (startWord > 0) {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.length > 0 && chunk[0].index >= startWord) {
        currentChunk = i;
        break;
      }
    }
  }

  /** Rebuild chunks with a new size, preserving position. */
  function rebuildChunks(newSize: number): void {
    const wordIdx = chunks[currentChunk]?.[0]?.index ?? 0;
    chunks = chunkWords(words, newSize);
    currentChunk = 0;
    for (let i = 0; i < chunks.length; i++) {
      if ((chunks[i]?.[0]?.index ?? 0) >= wordIdx) { currentChunk = i; break; }
    }
  }
  let paused = true;

  const tts = options.tts ? createTts() : null;

  const view = new SpeedReader({
    words: chunks,
    currentChunk,
    wpm,
    chunkSize,
    paused,
    theme: options.theme,
    text: content.text,
    allWords: words,
  });

  view.render();

  const getCurrentWordIndex = (): number => {
    const chunk = chunks[currentChunk];
    return chunk && chunk.length > 0 ? chunk[0].index : 0;
  };

  const syncTts = () => {
    if (!tts) return;
    const chunk = chunks[currentChunk];
    const w = chunk && chunk.length > 0 ? chunk[0] : null;
    if (w) ttsSpeak(tts, sentenceAt(content.text, w.charOffset), wpm);
  };

  syncTts(); // speak first sentence immediately

  while (true) {
    if (isResizePending()) break;
    if (paused) {
      // Blocked waiting for keypress
      const key = await readKey();
      const action = view.handleKey(key);
      if (!handleSpeedAction(action)) break;
    } else {
      // Race between timer tick and keypress
      const result = await raceTickKey(wpmToMs(wpm));

      if (result.type === "tick") {
        // Advance to next chunk
        if (currentChunk < chunks.length - 1) {
          currentChunk++;
          view.updateState({ currentChunk });
          view.render();
          syncTts();
          if (!options.noSave) {
            updateLastPosition(content.hash, positionToString({ type: "word", index: getCurrentWordIndex() })).catch(() => {});
          }
        } else {
          // Reached end — pause at last chunk
          paused = true;
          if (tts) ttsStop(tts);
          view.updateState({ paused });
          view.render();
        }
      } else {
        // Key was pressed
        const action = view.handleKey(result.key);
        if (!handleSpeedAction(action)) break;
      }
    }
  }

  if (tts) ttsStop(tts);
  view.reset();
  return getCurrentWordIndex();

  function handleSpeedAction(action: ReturnType<SpeedReader["handleKey"]>): boolean {
    if (action === "pause") {
      paused = !paused;
      if (tts) { paused ? ttsStop(tts) : syncTts(); }
      view.updateState({ paused });
      view.render();
    } else if (action === "next") {
      currentChunk = clamp(currentChunk + 1, 0, chunks.length - 1);
      view.updateState({ currentChunk });
      view.render();
      syncTts();
      if (!options.noSave) {
        updateLastPosition(content.hash, positionToString({ type: "word", index: getCurrentWordIndex() })).catch(() => {});
      }
    } else if (action === "prev") {
      currentChunk = clamp(currentChunk - 1, 0, chunks.length - 1);
      view.updateState({ currentChunk });
      view.render();
      syncTts();
      if (!options.noSave) {
        updateLastPosition(content.hash, positionToString({ type: "word", index: getCurrentWordIndex() })).catch(() => {});
      }
    } else if (action === "skip-sentence-fwd") {
      const wordsPerChunk = Math.max(1, chunkSize);
      const chunksToSkip = Math.ceil(SENTENCE_SKIP / wordsPerChunk);
      currentChunk = clamp(currentChunk + chunksToSkip, 0, chunks.length - 1);
      view.updateState({ currentChunk });
      view.render();
      syncTts();
    } else if (action === "skip-sentence-back") {
      const wordsPerChunk = Math.max(1, chunkSize);
      const chunksToSkip = Math.ceil(SENTENCE_SKIP / wordsPerChunk);
      currentChunk = clamp(currentChunk - chunksToSkip, 0, chunks.length - 1);
      view.updateState({ currentChunk });
      view.render();
      syncTts();
    } else if (action === "wpm-up") {
      wpm = Math.min(wpm + 25, 1500);
      view.updateState({ wpm });
      view.render();
      if (tts) { ttsStop(tts); syncTts(); } // restart at new rate
    } else if (action === "wpm-down") {
      wpm = Math.max(wpm - 25, 50);
      view.updateState({ wpm });
      view.render();
      if (tts) { ttsStop(tts); syncTts(); }
    } else if (action === "chunk-up") {
      chunkSize = Math.min(chunkSize + 1, 10);
      rebuildChunks(chunkSize);
      view.updateState({ words: chunks, currentChunk, chunkSize });
      view.render();
    } else if (action === "chunk-down") {
      chunkSize = Math.max(chunkSize - 1, 1);
      rebuildChunks(chunkSize);
      view.updateState({ words: chunks, currentChunk, chunkSize });
      view.render();
    } else if (action === "quit") {
      switchMode("page");
      return false;
    }
    return true;
  }
}

