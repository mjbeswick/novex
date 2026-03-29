# Plan: Improve Word Selection Index Display

## Goal
Fix issues and improve the hierarchical index display (ch/para/word) in both page view and speed reader.

## Issues to Fix

- [x] **1. O(n²) performance in `getWordIndexInParaFromWords`**
  - Replaced with `getWordIndexInParaFromPage` that only scans the target paragraph's lines
  - Added `countWordsInParagraph` helper for word count display

- [x] **2. Chapter index is 0-based while paragraph and word are 1-based**
  - All indices now 1-based in display: `§1.1.1`

- [x] **3. Index format uses confusing bracket syntax**
  - Changed to compact `§chapter.paragraph.word` format (e.g. `§1.3.5`)

- [x] **4. Fallback selection always has `wordIndexInPara: null`**
  - Updated `getHierarchicalIndexForWord` to use `getWordIndexInParaFromPage` fallback

- [x] **5. Speed reader hides entire index when `wordIndexInPara` is null**
  - Now shows `§chapter.paragraph` even without word position

- [x] **6. Paragraph selection doesn't show word count**
  - Shows `Para §1.3 (42 words)` when a paragraph is selected
