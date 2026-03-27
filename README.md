# lekto-cli

A powerful terminal-based reader for modern document formats. Read EPUB, DOCX, FB2, Markdown, and plain text files directly in your terminal with support for multiple reading modes, bookmarks, and smart position restoration.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### 📚 Supported Formats
- **EPUB** - Full support for electronic publications
- **DOCX** - Microsoft Word documents
- **FB2** - FictionBook format
- **Markdown** - With syntax highlighting
- **Plain Text** - Simple text files
- **HTML** - Web content

### 🎯 Reading Modes
- **Page Mode** - Traditional page-by-page reading with two-page spreads on wide terminals
- **Scroll Mode** - Continuous scrolling experience
- **Speed Reading** - RSVP-style rapid serial visual presentation with adjustable WPM
- **Mode Switching** - Switch between modes mid-reading without losing your place

### ✨ Smart Features
- **Position Restoration** - Automatically resumes from your last reading position
- **Bookmarks** - Mark important passages and create custom notes
- **Table of Contents** - Hierarchical chapter navigation
- **Image Support** - View embedded images in documents
- **Text-to-Speech** - Read along with audio narration (macOS/Linux)
- **Search** - Full-text search across your document
- **Themes** - Light and dark terminal themes
- **Responsive Layout** - Adapts to your terminal size

### 📊 Book Management
- **Reading Progress** - Track percentage read and last read time for all books
- **Book List** - View all previously read books with progress metadata
- **History Persistence** - Reading history stored in `~/.lekto/history.json`

## Installation

### Prerequisites
- [Bun](https://bun.sh/) runtime (v1.0+)
- Terminal with 256-color support (recommended)

### From Source
```bash
git clone https://github.com/mjbeswick/lekto-cli.git
cd lekto-cli
bun install
bun run build
```

The compiled binary will be available at `./lekto-cli`.

## Usage

### Quick Start

Open a file interactively:
```bash
lekto
```

Open a specific file:
```bash
lekto read path/to/book.epub
```

View your reading list:
```bash
lekto list
```

### Command Options

#### `read [file]`
Open a file for reading.

**Options:**
- `--mode <mode>` - Reading mode: `page` (default), `scroll`, `speed`, `rsvp`
- `--wpm <number>` - Words per minute for speed mode (default: 250)
- `--chunk <number>` - Chunk size for speed mode (default: 1)
- `--theme <theme>` - Color theme: `dark` (default), `light`
- `--line-width <chars>` - Maximum line width in characters
- `--position <position>` - Start at specific position (e.g., `page:5`, `word:200`)
- `--no-save` - Don't save reading position
- `--tts` - Enable text-to-speech

**Examples:**
```bash
# Open in speed reading mode at 300 WPM
lekto read book.epub --mode speed --wpm 300

# Open with light theme and no position saving
lekto read book.docx --theme light --no-save

# Start at a specific position
lekto read book.epub --position page:42

# Enable text-to-speech
lekto read book.epub --tts
```

#### `list`
Display and manage your reading list.

**Options:**
- `--theme <theme>` - Color theme: `dark` (default), `light`

From the list, you can:
- **↑↓** - Navigate through books
- **o** - Open selected book
- **f** - Forget (delete) a book from history
- **b** - Browse for new books
- **q** - Quit

### Reading Controls

#### Page Mode
- **n/→/↓** - Next page
- **p/←/↑** - Previous page
- **b** - Toggle bookmark
- **B** - View all bookmarks
- **s** - Switch to speed mode
- **v** - Switch to scroll mode
- **T** - Open table of contents
- **/​** - Search document
- **i** - View embedded image
- **?** - Help menu
- **q** - Quit

#### Scroll Mode
- **j/↓** - Scroll down one line
- **k/↑** - Scroll up one line
- **J/PgDn** - Scroll down one page
- **K/PgUp** - Scroll up one page
- **b** - Toggle bookmark
- **s** - Switch to speed mode
- **v** - Switch to page mode
- **q** - Quit

#### Speed Mode
- **Space** - Pause/Resume
- **n** - Next chunk
- **p** - Previous chunk
- **t** - Toggle text-to-speech
- **s** - Switch to page mode
- **v** - Switch to scroll mode
- **q** - Quit

## Configuration

### Reading History
Reading position and bookmarks are automatically saved to:
```
~/.lekto/history.json
```

This file stores:
- Last read position for each book
- Percentage completed
- Reading timestamp
- All bookmarks with notes

## Examples

### Daily Reading Session
```bash
# Open your reading list
lekto list

# Select a book to continue reading
# It automatically opens to your saved position
```

### Speed Reading
```bash
# Start in speed mode with 400 WPM
lekto read novel.epub --mode speed --wpm 400

# Adjust speed on-the-fly or switch modes during reading
```

### Markdown Documentation
```bash
# Read markdown files with syntax highlighting
lekto read documentation.md
```

### Custom Layout
```bash
# Set a specific line width for better readability
lekto read book.epub --line-width 80
```

## Architecture

### Core Components
- **CLI** (`src/cli.ts`) - Command-line interface and argument parsing
- **Readers** (`src/readers/`) - Format detection and content conversion
- **Runner** (`src/runner.ts`) - Reading session management and mode switching
- **UI** (`src/ui/`) - Terminal rendering and user interaction
- **Store** (`src/store.ts`) - Reading history persistence

### Content Pipeline
1. **Format Detection** - Identify file type from magic bytes and extensions
2. **Conversion** - Convert to standardized HTML representation
3. **Parsing** - Extract chapters, images, and structure
4. **Pagination** - Generate pages based on terminal size
5. **Rendering** - Display with terminal escape sequences

## Performance

- Efficient pagination handles books with 1000+ pages
- Lazy image loading for large documents
- Minimal memory footprint
- Fast mode switching without reprocessing content

## Troubleshooting

### Book position not restoring
- Check that `--no-save` is not being used
- Verify the file hasn't been modified (hash-based tracking)
- Check `~/.lekto/history.json` exists and is readable

### Text rendering issues
- Ensure terminal supports 256 colors: `echo $TERM`
- Try adjusting `--line-width` for better wrapping
- Switch themes with `--theme light` or `--theme dark`

### Performance with large files
- Switch to scroll mode for faster rendering
- Reduce line width to decrease pagination time
- Close other terminal applications for more resources

## Development

### Building
```bash
bun run build
```

### Type Checking
```bash
bun run typecheck
```

### Development Mode
```bash
bun run dev [file]
```

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

### Areas for Contribution
- Additional format support (mobi, AZW, etc.)
- Performance optimizations
- UI/UX improvements
- Documentation enhancements
- Cross-platform testing

## License

MIT License - See LICENSE file for details

## Acknowledgments

Built with [Bun](https://bun.sh/) - A fast JavaScript runtime and package manager.

Uses excellent libraries:
- [mammoth](https://github.com/mwilson/mammoth.js) - DOCX conversion
- [marked](https://github.com/markedjs/marked) - Markdown parsing
- [jszip](https://github.com/Stuk/jszip) - ZIP file handling
- [node-html-parser](https://github.com/taoqf/node-html-parser) - HTML parsing

---

**Made with ❤️ for terminal enthusiasts and bibliophiles**
