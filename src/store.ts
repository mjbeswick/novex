import type { HistoryStore, FileState, Bookmark } from "./types";
import { join } from "node:path";

const LEKTO_DIR = join(Bun.env.HOME ?? "~", ".lekto");
const HISTORY_FILE = join(LEKTO_DIR, "history.json");

/**
 * Ensures the ~/.lekto/ directory exists.
 */
async function ensureLektoDir(): Promise<void> {
  const dir = Bun.file(LEKTO_DIR);
  // Bun.file doesn't directly check directory existence; use mkdir
  await Bun.$`mkdir -p ${LEKTO_DIR}`.quiet();
}

/**
 * Loads the history store from ~/.lekto/history.json.
 * Returns an empty store if the file does not exist.
 */
export async function loadHistory(): Promise<HistoryStore> {
  await ensureLektoDir();

  const file = Bun.file(HISTORY_FILE);
  const exists = await file.exists();

  if (!exists) {
    return {};
  }

  try {
    const text = await file.text();
    return JSON.parse(text) as HistoryStore;
  } catch {
    // If the file is corrupted or unreadable, start fresh
    return {};
  }
}

/**
 * Saves the history store to ~/.lekto/history.json.
 */
export async function saveHistory(store: HistoryStore): Promise<void> {
  await ensureLektoDir();
  await Bun.write(HISTORY_FILE, JSON.stringify(store, null, 2));
}

/**
 * Gets the FileState for the given hash, or null if not found.
 */
export async function getFileState(hash: string): Promise<FileState | null> {
  const store = await loadHistory();
  return store[hash] ?? null;
}

/**
 * Saves (upserts) the FileState for the given hash.
 */
export async function saveFileState(
  hash: string,
  state: FileState
): Promise<void> {
  const store = await loadHistory();
  store[hash] = state;
  await saveHistory(store);
}

/**
 * Initializes or gets a FileState entry with source and title.
 */
export async function initializeFileState(
  hash: string,
  source: string,
  title: string
): Promise<FileState> {
  const store = await loadHistory();

  if (!store[hash]) {
    store[hash] = {
      bookmarks: [],
      lastPosition: "",
      lastRead: new Date().toISOString(),
      source,
      title,
    };
    await saveHistory(store);
  }

  return store[hash];
}

/**
 * Adds a bookmark to the FileState for the given hash.
 * Creates a new FileState entry if one does not already exist.
 */
export async function addBookmark(
  hash: string,
  bookmark: Bookmark,
  source?: string,
  title?: string
): Promise<void> {
  const store = await loadHistory();

  if (!store[hash]) {
    store[hash] = {
      bookmarks: [],
      lastPosition: "",
      lastRead: new Date().toISOString(),
      source: source ?? "",
      title: title ?? "",
    };
  }

  const exists = store[hash].bookmarks.some(b => b.position === bookmark.position);
  if (exists) return;

  store[hash].bookmarks.push(bookmark);
  await saveHistory(store);
}

/**
 * Deletes the bookmark at the given index for the given hash.
 */
export async function deleteBookmark(hash: string, index: number): Promise<void> {
  const store = await loadHistory();
  if (store[hash]) {
    store[hash].bookmarks.splice(index, 1);
    await saveHistory(store);
  }
}

/**
 * Lists all books (file entries) in the history with their hashes.
 * Returns entries sorted by lastRead (most recent first).
 * Only includes entries that have a source (can be reopened).
 */
export async function listBooks(): Promise<Array<{ hash: string; state: FileState }>> {
  const store = await loadHistory();
  const entries = Object.entries(store)
    .filter(([_, state]) => state.source) // Only include entries with a source file
    .map(([hash, state]) => ({ hash, state }))
    .sort((a, b) => new Date(b.state.lastRead).getTime() - new Date(a.state.lastRead).getTime());
  return entries;
}

/**
 * Deletes a book (file entry) from the history by hash.
 */
export async function deleteBook(hash: string): Promise<void> {
  const store = await loadHistory();
  delete store[hash];
  await saveHistory(store);
}

/**
 * Updates the lastPosition for the given hash.
 * Creates a new FileState entry if one does not already exist.
 */
export async function updateLastPosition(
  hash: string,
  position: string,
  source?: string,
  title?: string
): Promise<void> {
  const store = await loadHistory();

  if (!store[hash]) {
    store[hash] = {
      bookmarks: [],
      lastPosition: position,
      lastRead: new Date().toISOString(),
      source: source ?? "",
      title: title ?? "",
    };
  } else {
    store[hash].lastPosition = position;
    store[hash].lastRead = new Date().toISOString();
    if (source) store[hash].source = source;
    if (title) store[hash].title = title;
  }

  await saveHistory(store);
}
