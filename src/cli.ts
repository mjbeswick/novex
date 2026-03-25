#!/usr/bin/env bun
import { Command } from "commander";
import type { CLIOptions, Theme, ReadingMode } from "./types.ts";
import { readFromFile, readFromStdin, isStdinPiped, selectFileInteractive } from "./input.ts";
import { detectFormat, convertToContent } from "./readers/index.ts";
import { getFileState } from "./store.ts";
import { showCursor, disableRawMode } from "./ui/index.ts";
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
