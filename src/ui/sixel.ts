/**
 * Sixel image rendering support for terminal display.
 * Sixel is a protocol supported by kitty, xterm, and other modern terminals.
 */

/**
 * Detects if the terminal supports sixel protocol.
 * This is a best-effort detection based on TERM environment variable.
 */
export function supportsXixel(): boolean {
  const term = Bun.env.TERM || "";
  // Sixel support in: kitty, xterm with -ti parameter, mlterm, yaft
  return (
    term.includes("xterm") ||
    term.includes("kitty") ||
    term.includes("mlterm") ||
    term.includes("yaft") ||
    Bun.env.KITTY_WINDOW_ID !== undefined // Detect kitty directly
  );
}

/**
 * Converts image data (buffer or base64) to sixel format.
 * Uses `convert` from ImageMagick if available.
 * Falls back to placeholder if conversion fails.
 */
export async function imageToSixel(
  imageData: Buffer | string,
  maxWidth: number = 40
): Promise<string | null> {
  try {
    // If it's base64 data URL, extract the base64 part
    let imageBuffer: Buffer;
    if (typeof imageData === "string") {
      if (imageData.startsWith("data:")) {
        const base64 = imageData.split(",")[1];
        imageBuffer = Buffer.from(base64, "base64");
      } else {
        imageBuffer = Buffer.from(imageData, "base64");
      }
    } else {
      imageBuffer = imageData;
    }

    // Try to use imagemagick convert to create sixel
    // This is a best-effort approach; if not installed, return null
    const tmpFile = `/tmp/lekto_cover_${Date.now()}.png`;
    const outFile = `/tmp/lekto_sixel_${Date.now()}.txt`;

    // Write image to temp file
    await Bun.write(tmpFile, imageBuffer);

    try {
      // Use convert (from ImageMagick) to resize and output as sixel
      // If not available, this will fail gracefully (convert not found is expected)
      const proc = Bun.spawn([
        "sh",
        "-c",
        `convert "${tmpFile}" -resize ${maxWidth}x30 sixel:"${outFile}" 2>/dev/null`,
      ]);
      await proc.exited;

      const sixelFile = Bun.file(outFile);
      if (await sixelFile.exists()) {
        const result = await sixelFile.text();

        // Clean up
        await Bun.spawn(["rm", tmpFile, outFile]).exited.catch(() => {});

        return result;
      }

      return null;
    } catch {
      // convert not available or failed
      try {
        await Bun.spawn(["rm", tmpFile, outFile]).exited;
      } catch {
        // ignore cleanup errors
      }
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Displays an image with sixel rendering or a text placeholder.
 * Silently falls back if sixel or ImageMagick unavailable.
 */
export async function displayImage(
  imageData: Buffer | string,
  title: string = "Cover"
): Promise<void> {
  if (!supportsXixel()) {
    // Terminal doesn't support sixel, silently skip
    return;
  }

  try {
    const sixelData = await imageToSixel(imageData);
    if (sixelData && sixelData.length > 0) {
      // Render with sixel
      process.stdout.write(sixelData);
      process.stdout.write("\n");
    }
    // If sixel conversion failed, silently skip (ImageMagick not installed)
  } catch {
    // Silently fail - cover display is optional
  }
}
