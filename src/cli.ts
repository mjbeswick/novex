#!/usr/bin/env bun
import { Command } from "commander";
import type { CLIOptions, Theme, ReadingMode } from "./types.ts";
import { readFromFile, readFromStdin, isStdinPiped, selectFileInteractive, browseBooksDirectory } from "./input.ts";
import { detectFormat, convertToContent } from "./readers/index.ts";
import { getFileState, listBooks, deleteBook } from "./store.ts";
import { showCursor, disableRawMode, showBooksList, enableRawMode, hideCursor, enterAltScreen, exitAltScreen } from "./ui/index.ts";
import { runSession } from "./runner.ts";

const program = new Command();

program
  .name("lekto")
  .description("Terminal-based reader for EPUB, DOCX, FB2, Markdown, and plain text")
  .version("0.1.0");

program
  .command("read [file]")
  .description("Open a file for reading")
  .option("--mode <mode>", "Reading mode: page | scroll | speed | rsvp", "page")
  .option("--wpm <number>", "Words per minute for speed/rsvp modes", "250")
  .option("--chunk <number>", "Chunk size for speed mode", "1")
  .option("--theme <theme>", "Color theme: dark | light", "dark")
  .option("--line-width <chars>", "Maximum line width in characters")
  .option("--position <position>", "Start at position (e.g. page:5 or word:200)")
  .option("--no-save", "Disable saving reading position")
  .option("--tts", "Enable text-to-speech synchronized with reading")
  .action(async (file: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    try {
      // Determine input source
      let buffer: Uint8Array;
      let source: string;

      if (file) {
        ({ buffer, source } = await readFromFile(file));
      } else if (isStdinPiped()) {
        ({ buffer, source } = await readFromStdin());
      } else {
        const selected = await selectFileInteractive();
        if (selected === null) {
          program.help({ error: false });
          process.exit(0);
        }
        ({ buffer, source } = await readFromFile(selected));
      }

      // Detect format and convert
      const format = detectFormat(source, buffer);
      const content = await convertToContent(source, buffer, format);

      // Build CLI options
      const options: CLIOptions = {
        mode: (opts["mode"] as ReadingMode) ?? "page",
        wpm: parseInt((opts["wpm"] as string) ?? "250", 10),
        chunk: parseInt((opts["chunk"] as string) ?? "1", 10),
        theme: (opts["theme"] as Theme) ?? "dark",
        lineWidth: opts["lineWidth"] ? parseInt(opts["lineWidth"] as string, 10) : undefined,
        position: opts["position"] as string | undefined,
        noSave: opts["save"] === false,
        tts: opts["tts"] === true,
      };

      // Determine initial position
      let initialPosition: string | undefined = options.position;

      if (!initialPosition && !options.noSave) {
        const state = await getFileState(content.hash);
        if (state?.lastPosition) {
          initialPosition = state.lastPosition;
        }
      }

      // Launch the reading session
      await runSession(content, options, initialPosition);
    } catch (err) {
      showCursor();
      disableRawMode();
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nError: ${message}\n`);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("Show list of read books")
  .option("--theme <theme>", "Color theme: dark | light", "dark")
  .action(async (opts: Record<string, string | undefined>) => {
    try {
      const theme: Theme = (opts["theme"] as Theme) ?? "dark";

      let books = await listBooks();

      if (books.length === 0) {
        console.log("No books read yet.");
        process.exit(0);
      }

      enableRawMode();
      hideCursor();
      enterAltScreen();

      try {
        let selectedHash: string | null = null;

        selectedHash = await showBooksList(books, theme, async (hash) => {
          await deleteBook(hash);
        }, async () => {
          exitAltScreen();
          showCursor();
          disableRawMode();

          try {
            const newBookPath = await browseBooksDirectory();

            enableRawMode();
            hideCursor();
            enterAltScreen();

            if (newBookPath) {
              const { buffer, source } = await readFromFile(newBookPath);
            const format = detectFormat(source, buffer);
            const content = await convertToContent(source, buffer, format);
            const options: CLIOptions = {
              mode: "page",
              wpm: 250,
              chunk: 1,
              theme,
              lineWidth: undefined,
              position: undefined,
              noSave: false,
              tts: false,
            };

            exitAltScreen();
            showCursor();
            disableRawMode();

            await runSession(content, options);

            // Refresh book list after reading
            const updatedBooks = await listBooks();
            if (updatedBooks.length > books.length) {
              books = updatedBooks;
            }

            enableRawMode();
            hideCursor();
            enterAltScreen();
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`\nError during browse: ${msg}\n`);
            enableRawMode();
            hideCursor();
            enterAltScreen();
          }
        });

        if (selectedHash) {
          // Find the book file to reload it
          const book = books.find((b) => b.hash === selectedHash);
          if (book && book.state.source) {
            const { buffer, source } = await readFromFile(book.state.source);
            const format = detectFormat(source, buffer);
            const content = await convertToContent(source, buffer, format);

            // Get the reading position and options
            const state = await getFileState(content.hash);
            const initialPosition = state?.lastPosition;

            const options: CLIOptions = {
              mode: "page",
              wpm: 250,
              chunk: 1,
              theme,
              lineWidth: undefined,
              position: initialPosition,
              noSave: false,
              tts: false,
            };

            exitAltScreen();
            showCursor();
            disableRawMode();

            await runSession(content, options, initialPosition);
          }
        }
      } finally {
        exitAltScreen();
        showCursor();
        disableRawMode();
      }
    } catch (err) {
      showCursor();
      disableRawMode();
      exitAltScreen();
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nError: ${message}\n`);
      process.exit(1);
    }
  });

// Default command when no subcommand given — treat as `read`
program
  .argument("[file]")
  .option("--mode <mode>", "Reading mode: page | scroll | speed | rsvp", "page")
  .option("--wpm <number>", "Words per minute for speed/rsvp modes", "250")
  .option("--chunk <number>", "Chunk size for speed mode", "1")
  .option("--theme <theme>", "Color theme: dark | light", "dark")
  .option("--line-width <chars>", "Maximum line width in characters")
  .option("--position <position>", "Start at position (e.g. page:5 or word:200)")
  .option("--no-save", "Disable saving reading position")
  .option("--tts", "Enable text-to-speech synchronized with reading")
  .action(async (file: string | undefined, opts: Record<string, string | boolean | undefined>) => {
    // Only run if no subcommand was invoked
    try {
      let buffer: Uint8Array | undefined;
      let source: string | undefined;
      let selectedHash: string | null = null;

      if (file) {
        ({ buffer, source } = await readFromFile(file));
      } else if (isStdinPiped()) {
        ({ buffer, source } = await readFromStdin());
      } else {
        // Try to show books list if there are any books
        const books = await listBooks();
        const theme: Theme = (opts["theme"] as Theme) ?? "dark";

        if (books.length > 0) {
          enableRawMode();
          hideCursor();
          enterAltScreen();

          try {
            selectedHash = await showBooksList(books, theme, async (hash) => {
              await deleteBook(hash);
            }, async () => {
              exitAltScreen();
              showCursor();
              disableRawMode();

              const newBookPath = await browseBooksDirectory();

              if (newBookPath) {
                ({ buffer, source } = await readFromFile(newBookPath));
              }

              enableRawMode();
              hideCursor();
              enterAltScreen();
            });
          } finally {
            exitAltScreen();
            showCursor();
            disableRawMode();
          }

          if (selectedHash && !buffer) {
            // Find and open the selected book
            const book = books.find((b) => b.hash === selectedHash);
            if (book && book.state.source) {
              ({ buffer, source } = await readFromFile(book.state.source));
            } else {
              program.help({ error: false });
              process.exit(0);
            }
          } else if (!buffer) {
            // User dismissed the list and didn't browse, show file selector
            const selected = await selectFileInteractive();
            if (selected === null) {
              program.help({ error: false });
              process.exit(0);
            }
            ({ buffer, source } = await readFromFile(selected));
          }
        } else {
          // No books in history, show browse or file selector
          enableRawMode();
          hideCursor();
          enterAltScreen();

          try {
            await showBooksList([], theme, async () => {}, async () => {
              exitAltScreen();
              showCursor();
              disableRawMode();

              try {
                const newBookPath = await browseBooksDirectory();

                if (newBookPath) {
                  ({ buffer, source } = await readFromFile(newBookPath));
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`\nError during browse: ${msg}\n`);
              }

              enableRawMode();
              hideCursor();
              enterAltScreen();
            });
          } finally {
            exitAltScreen();
            showCursor();
            disableRawMode();
          }

          if (!buffer) {
            // User didn't select from browse, fall back to file selector
            const selected = await selectFileInteractive();
            if (selected === null) {
              program.help({ error: false });
              process.exit(0);
            }
            ({ buffer, source } = await readFromFile(selected));
          }
        }
      }

      // Ensure buffer and source are defined
      if (!buffer || !source) {
        process.stderr.write("Error: No file selected\n");
        process.exit(1);
      }

      const format = detectFormat(source, buffer);
      const content = await convertToContent(source, buffer, format);

      const options: CLIOptions = {
        mode: (opts["mode"] as ReadingMode) ?? "page",
        wpm: parseInt((opts["wpm"] as string) ?? "250", 10),
        chunk: parseInt((opts["chunk"] as string) ?? "1", 10),
        theme: (opts["theme"] as Theme) ?? "dark",
        lineWidth: opts["lineWidth"] ? parseInt(opts["lineWidth"] as string, 10) : undefined,
        position: opts["position"] as string | undefined,
        noSave: opts["save"] === false,
        tts: opts["tts"] === true,
      };

      let initialPosition: string | undefined = options.position;

      if (!initialPosition && !options.noSave) {
        const state = await getFileState(content.hash);
        if (state?.lastPosition) {
          initialPosition = state.lastPosition;
        }
      }

      await runSession(content, options, initialPosition);
    } catch (err) {
      showCursor();
      disableRawMode();
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nError: ${message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
