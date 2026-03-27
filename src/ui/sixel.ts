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

/**
 * Displays an image using iTerm2's inline image protocol (OSC 1337).
 */
function displayITermImage(imageBuffer: Buffer): void {
  const base64 = imageBuffer.toString("base64");
  // OSC 1337 ; File=[params] : base64data ST
  // width=auto;height=auto;preserveAspectRatio=1;inline=1
  const osc = `\x1b]1337;File=inline=1;width=40;preserveAspectRatio=1:${base64}\x07`;
  process.stdout.write(osc);
  process.stdout.write("\n");
}

/**
 * Converts image data to sixel format using ImageMagick.
 */
async function imageToSixel(
  imageBuffer: Buffer,
  maxWidth: number = 40
): Promise<string | null> {
  const tmpFile = `/tmp/lekto_cover_${Date.now()}.png`;
  const outFile = `/tmp/lekto_sixel_${Date.now()}.txt`;

  await Bun.write(tmpFile, imageBuffer);

  try {
    const proc = Bun.spawn([
      "sh",
      "-c",
      `convert "${tmpFile}" -resize ${maxWidth}x30 sixel:"${outFile}" 2>/dev/null`,
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

/**
 * Displays an image in the terminal.
 * Uses iTerm2 inline images or sixel depending on the terminal.
 * Silently skips if the terminal doesn't support image display.
 */
export async function displayImage(
  imageData: Buffer | string,
  _title: string = "Cover"
): Promise<void> {
  try {
    const imageBuffer = toBuffer(imageData);

    if (isITerm()) {
      displayITermImage(imageBuffer);
      return;
    }

    if (supportsSixel()) {
      const sixelData = await imageToSixel(imageBuffer);
      if (sixelData && sixelData.length > 0) {
        process.stdout.write(sixelData);
        process.stdout.write("\n");
      }
    }
  } catch {
    // Silently fail - cover display is optional
  }
}
