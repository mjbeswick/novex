#!/usr/bin/env bun
import { Command } from "commander";
import type { CLIOptions, Theme, ReadingMode } from "./types.ts";
import { readFromFile, readFromStdin, isStdinPiped, selectFileInteractive, browseDirectory } from "./input.ts";
import { detectFormat, convertToContent } from "./readers/index.ts";
import { getFileState, listBooks, deleteBook } from "./store.ts";
import { showCursor, disableRawMode, showBooksList, enableRawMode, hideCursor, enterAltScreen, exitAltScreen } from "./ui/index.ts";
import { runSession } from "./runner.ts";

const program = new Command();

program
  .name("novex")
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
        while (true) {
          let selectedHash: string | null = null;

          selectedHash = await showBooksList(books, theme, async (hash) => {
            await deleteBook(hash);
          }, async () => {
            exitAltScreen();
            showCursor();
            disableRawMode();

            try {
              const newBookPath = await browseDirectory(process.cwd(), theme);

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

                await runSession(content, options);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(`\nError during browse: ${msg}\n`);
            }

            // Refresh book list and return to it
            books = await listBooks();
            enableRawMode();
            hideCursor();
            enterAltScreen();
          });

          if (selectedHash) {
            const book = books.find((b) => b.hash === selectedHash);
            if (book && book.state.source) {
              const { buffer, source } = await readFromFile(book.state.source);
              const format = detectFormat(source, buffer);
              const content = await convertToContent(source, buffer, format);

              // Use the book's hash from the list, not the newly computed hash
              const state = await getFileState(book.hash);
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

              // Return to book list
              books = await listBooks();
              enableRawMode();
              hideCursor();
              enterAltScreen();
              continue;
            }
          }

          // User quit the book list
          break;
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
  .argument("[files...]")
  .option("--mode <mode>", "Reading mode: page | scroll | speed | rsvp", "page")
  .option("--wpm <number>", "Words per minute for speed/rsvp modes", "250")
  .option("--chunk <number>", "Chunk size for speed mode", "1")
  .option("--theme <theme>", "Color theme: dark | light", "dark")
  .option("--line-width <chars>", "Maximum line width in characters")
  .option("--position <position>", "Start at position (e.g. page:5 or word:200)")
  .option("--no-save", "Disable saving reading position")
  .option("--tts", "Enable text-to-speech synchronized with reading")
  .action(async (files: string[], opts: Record<string, string | boolean | undefined>) => {
    // Only run if no subcommand was invoked
    try {
      const theme: Theme = (opts["theme"] as Theme) ?? "dark";
      let buffer: Uint8Array | undefined;
      let source: string | undefined;
      let selectedHash: string | null = null;

      // Helper to check if a path is a directory
      const isDir = async (path: string): Promise<boolean> => {
        try {
          // Try to list contents - if this succeeds, it's a directory
          const dirTest = new Bun.Glob("*").scan({ cwd: path });
          // Try to read at least one entry (or verify it's empty but accessible)
          let hasAccess = false;
          for await (const _ of dirTest) {
            hasAccess = true;
            break;
          }
          // If we can iterate (even with 0 results), it's a valid directory
          return true;
        } catch {
          return false;
        }
      };

      // Determine how to proceed based on arguments
      let file: string | undefined;
      let searchDir = process.cwd();
      let isDirectory = false;
      let hasMultiplePaths = files && files.length > 1;

      if (files && files.length === 1) {
        // Single file/directory provided
        file = files[0];
        const filePath = require('path').resolve(file);
        isDirectory = await isDir(filePath);
        if (!isDirectory) {
          searchDir = require('path').dirname(filePath);
        } else {
          searchDir = filePath;
        }
      } else if (hasMultiplePaths) {
        // Multiple paths provided - collect all files and show selection
        const path = require('path');
        const allFiles: string[] = [];

        for (const inputPath of files) {
          const resolvedPath = path.resolve(inputPath);
          if (await isDir(resolvedPath)) {
            // Scan directory recursively
            const glob = new Bun.Glob(`**/*.{epub,docx,fb2,md,markdown,txt,html,htm}`);
            for await (const f of glob.scan({ cwd: resolvedPath, onlyFiles: true })) {
              allFiles.push(path.resolve(resolvedPath, f));
            }
          } else {
            // It's a file
            allFiles.push(resolvedPath);
          }
        }

        if (allFiles.length === 0) {
          process.stderr.write("No readable files found in provided paths\n");
          process.exit(1);
        } else if (allFiles.length === 1) {
          file = allFiles[0];
        } else {
          // Multiple files - show selection dialog
          enableRawMode();
          hideCursor();
          enterAltScreen();

          try {
            const theme: Theme = (opts["theme"] as Theme) ?? "dark";
            const t = require('./ui/themes').themes[theme];

            // Simple selection dialog
            let selected = 0;
            const renderMenu = () => {
              require('./ui/terminal').clearScreen();
              require('./ui/terminal').moveTo(2, 1);
              process.stdout.write(
                t.accent + require('./ui/terminal').ANSI.bold +
                "Select a book:" +
                require('./ui/terminal').ANSI.reset
              );

              for (let i = 0; i < allFiles.length; i++) {
                require('./ui/terminal').moveTo(4 + i, 1);
                const fileName = require('path').basename(allFiles[i]);
                if (i === selected) {
                  process.stdout.write(
                    t.selectionBg +
                    `  ${fileName}` +
                    require('./ui/terminal').ANSI.reset
                  );
                } else {
                  process.stdout.write(`  ${fileName}`);
                }
              }
            };

            renderMenu();

            let done = false;
            while (!done) {
              const key = await require('./ui/terminal').readKey();
              if (key === "up" || key === "k") {
                selected = Math.max(0, selected - 1);
                renderMenu();
              } else if (key === "down" || key === "j") {
                selected = Math.min(allFiles.length - 1, selected + 1);
                renderMenu();
              } else if (key === "enter") {
                file = allFiles[selected];
                done = true;
              } else if (key === "escape" || key === "q") {
                done = true;
              }
            }

            exitAltScreen();
            showCursor();
            disableRawMode();

            if (!file) {
              process.exit(0);
            }
          } catch (err) {
            exitAltScreen();
            showCursor();
            disableRawMode();
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`\nError: ${msg}\n`);
            process.exit(1);
          }
        }
      }

      // Now handle the selected file/directory
      if (file && !isDirectory) {
        ({ buffer, source } = await readFromFile(file));
      } else if (isStdinPiped()) {
        ({ buffer, source } = await readFromStdin());
      } else if (isDirectory) {
        // Directory passed - browse loop: browse → read → back to browse
        while (true) {
          const newBookPath = await browseDirectory(searchDir, theme);

          if (!newBookPath) {
            process.exit(0);
          }

          const { buffer: buf, source: src } = await readFromFile(newBookPath);
          const format = detectFormat(src, buf);
          const content = await convertToContent(src, buf, format);

          const readOpts: CLIOptions = {
            mode: (opts["mode"] as ReadingMode) ?? "page",
            wpm: parseInt((opts["wpm"] as string) ?? "250", 10),
            chunk: parseInt((opts["chunk"] as string) ?? "1", 10),
            theme,
            lineWidth: opts["lineWidth"] ? parseInt(opts["lineWidth"] as string, 10) : undefined,
            position: opts["position"] as string | undefined,
            noSave: opts["save"] === false,
            tts: opts["tts"] === true,
          };

          let initialPos: string | undefined = readOpts.position;
          if (!initialPos && !readOpts.noSave) {
            const state = await getFileState(content.hash);
            if (state?.lastPosition) initialPos = state.lastPosition;
          }

          await runSession(content, readOpts, initialPos);
        }
      } else {
        // No arguments - show book list loop
        let books = await listBooks();

        // Helper to open a book file and run the reading session
        const openAndRead = async (filePath: string, position?: string) => {
          const { buffer: buf, source: src } = await readFromFile(filePath);
          const format = detectFormat(src, buf);
          const content = await convertToContent(src, buf, format);

          const readOpts: CLIOptions = {
            mode: (opts["mode"] as ReadingMode) ?? "page",
            wpm: parseInt((opts["wpm"] as string) ?? "250", 10),
            chunk: parseInt((opts["chunk"] as string) ?? "1", 10),
            theme,
            lineWidth: opts["lineWidth"] ? parseInt(opts["lineWidth"] as string, 10) : undefined,
            position: position ?? (opts["position"] as string | undefined),
            noSave: opts["save"] === false,
            tts: opts["tts"] === true,
          };

          let initialPos: string | undefined = readOpts.position;
          if (!initialPos && !readOpts.noSave) {
            const state = await getFileState(content.hash);
            if (state?.lastPosition) initialPos = state.lastPosition;
          }

          await runSession(content, readOpts, initialPos);
        };

        enableRawMode();
        hideCursor();
        enterAltScreen();

        try {
          while (true) {
            selectedHash = await showBooksList(books, theme, async (hash) => {
              await deleteBook(hash);
            }, async () => {
              exitAltScreen();
              showCursor();
              disableRawMode();

              try {
                const newBookPath = await browseDirectory(searchDir, theme);
                if (newBookPath) {
                  await openAndRead(newBookPath);
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`\nError during browse: ${msg}\n`);
              }

              books = await listBooks();
              enableRawMode();
              hideCursor();
              enterAltScreen();
            });

            if (selectedHash) {
              const book = books.find((b) => b.hash === selectedHash);
              if (book && book.state.source) {
                exitAltScreen();
                showCursor();
                disableRawMode();

                const state = await getFileState(book.hash);
                await openAndRead(book.state.source, state?.lastPosition);

                books = await listBooks();
                enableRawMode();
                hideCursor();
                enterAltScreen();
                continue;
              }
            }

            // User quit the book list
            break;
          }
        } finally {
          exitAltScreen();
          showCursor();
          disableRawMode();
        }

        process.exit(0);
      }

      // Direct file or stdin - read once and exit
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
