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
 * Adds a bookmark to the FileState for the given hash.
 * Creates a new FileState entry if one does not already exist.
 */
export async function addBookmark(
  hash: string,
  bookmark: Bookmark
): Promise<void> {
  const store = await loadHistory();

  if (!store[hash]) {
    store[hash] = {
      bookmarks: [],
      lastPosition: "",
      lastRead: new Date().toISOString(),
    };
  }

  store[hash].bookmarks.push(bookmark);
  await saveHistory(store);
}

/**
 * Updates the lastPosition for the given hash.
 * Creates a new FileState entry if one does not already exist.
 */
export async function updateLastPosition(
  hash: string,
  position: string
): Promise<void> {
  const store = await loadHistory();

  if (!store[hash]) {
    store[hash] = {
      bookmarks: [],
      lastPosition: position,
      lastRead: new Date().toISOString(),
    };
  } else {
    store[hash].lastPosition = position;
    store[hash].lastRead = new Date().toISOString();
  }

  await saveHistory(store);
}
