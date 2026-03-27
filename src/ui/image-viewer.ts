/**
 * Image viewing support via external applications.
 * Uses environment variable LEKTO_IMAGE_VIEWER or system defaults.
 */

/**
 * Opens an image file with the configured viewer.
 * Uses LEKTO_IMAGE_VIEWER env var, or falls back to system default.
 */
export async function openImage(imagePath: string): Promise<void> {
  const viewer = Bun.env.LEKTO_IMAGE_VIEWER;

  try {
    if (viewer) {
      // User has configured a custom viewer
      await Bun.spawn([viewer, imagePath]).exited;
    } else {
      // Use system default
      if (process.platform === "darwin") {
        // macOS
        await Bun.spawn(["open", imagePath]).exited;
      } else if (process.platform === "linux") {
        // Linux
        await Bun.spawn(["xdg-open", imagePath]).exited;
      } else if (process.platform === "win32") {
        // Windows
        await Bun.spawn(["start", imagePath]).exited;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nError opening image: ${msg}\n`);
  }
}
