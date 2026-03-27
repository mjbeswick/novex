/**
 * Terminal image rendering support.
 * Supports iTerm2 inline images (OSC 1337) and sixel protocol.
 */

/**
 * Detects if running inside iTerm2.
 */
function isITerm(): boolean {
  return (
    Bun.env.TERM_PROGRAM === "iTerm.app" ||
    Bun.env.LC_TERMINAL === "iTerm2" ||
    Bun.env.ITERM_SESSION_ID !== undefined
  );
}

/**
 * Detects if the terminal supports sixel protocol.
 */
function supportsSixel(): boolean {
  const term = Bun.env.TERM || "";
  return (
    term.includes("kitty") ||
    term.includes("mlterm") ||
    term.includes("yaft") ||
    Bun.env.KITTY_WINDOW_ID !== undefined
  );
}

/**
 * Extracts a raw image buffer from image data (buffer or base64/data URL string).
 */
function toBuffer(imageData: Buffer | string): Buffer {
  if (typeof imageData === "string") {
    if (imageData.startsWith("data:")) {
      const base64 = imageData.split(",")[1];
      return Buffer.from(base64, "base64");
    }
    return Buffer.from(imageData, "base64");
  }
  return imageData;
}

export interface PreparedImage {
  /** Terminal escape sequence to render the image */
  escape: string;
  /** Number of terminal rows the image occupies */
  rows: number;
}

/**
 * Prepares an inline image for rendering in the terminal.
 * Returns the escape sequence and number of rows it occupies,
 * or null if the terminal doesn't support inline images.
 */
export async function prepareInlineImage(
  imageData: Buffer | string,
  heightRows: number = 15,
  maxWidthCols?: number
): Promise<PreparedImage | null> {
  try {
    const imageBuffer = toBuffer(imageData);

    if (isITerm()) {
      const base64 = imageBuffer.toString("base64");
      const widthParam = maxWidthCols ? `;width=${maxWidthCols}` : "";
      const escape = `\x1b]1337;File=inline=1;height=${heightRows}${widthParam};preserveAspectRatio=1:${base64}\x07`;
      return { escape, rows: heightRows };
    }

    if (supportsSixel()) {
      const sixelData = await convertToSixel(imageBuffer, heightRows);
      if (sixelData) {
        return { escape: sixelData, rows: heightRows };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Converts image data to sixel format using ImageMagick.
 */
async function convertToSixel(
  imageBuffer: Buffer,
  heightRows: number
): Promise<string | null> {
  const tmpFile = `/tmp/lekto_cover_${Date.now()}.png`;
  const outFile = `/tmp/lekto_sixel_${Date.now()}.txt`;

  await Bun.write(tmpFile, imageBuffer);

  try {
    // Estimate pixel height: assume ~16px per character row
    const pixelHeight = heightRows * 16;
    const proc = Bun.spawn([
      "sh",
      "-c",
      `convert "${tmpFile}" -resize x${pixelHeight} sixel:"${outFile}" 2>/dev/null`,
    ]);
    await proc.exited;

    const sixelFile = Bun.file(outFile);
    if (await sixelFile.exists()) {
      const result = await sixelFile.text();
      await Bun.spawn(["rm", tmpFile, outFile]).exited.catch(() => {});
      return result;
    }

    return null;
  } catch {
    try {
      await Bun.spawn(["rm", tmpFile, outFile]).exited;
    } catch {
      // ignore cleanup errors
    }
    return null;
  }
}
