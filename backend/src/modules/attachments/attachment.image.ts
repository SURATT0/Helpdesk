import sharp from "sharp";
import { logger } from "../../shared/logger";

/**
 * Image work done once, at upload, instead of on every read.
 *
 * Two things come out of here and both are optional by design:
 *
 *   dimensions  so the thread can reserve the right box before the bytes land.
 *               A chat scrolls; an image that appears with no reserved height
 *               shoves everything below it, which is the one layout bug a reader
 *               actually notices.
 *   thumbnail   so a bubble loads an 800px copy instead of a 12-megapixel phone
 *               photo. The full file is what the lightbox opens.
 *
 * Every failure here is non-fatal. A corrupt or exotic image still uploads —
 * losing the file because we could not shrink it would be a worse outcome than
 * serving the original — and the reader falls back to the full image with no
 * reserved box. See `processImage`.
 */

/** Width the thread's copy is capped at. Height follows the aspect ratio. */
export const THUMB_MAX_WIDTH = 800;

export type ImageFacts = {
  width: number | null;
  height: number | null;
  /** Resized bytes, or null when the original is already small enough. */
  thumbnail: Buffer | null;
};

const NONE: ImageFacts = { width: null, height: null, thumbnail: null };

/**
 * Measure and, if it is worth it, shrink.
 *
 * Never throws: `sharp` rejects on truncated files, unsupported colour profiles
 * and a long tail of real-world oddities, and none of those are reasons to fail
 * an upload the user is watching.
 */
export async function processImage(buffer: Buffer): Promise<ImageFacts> {
  let width: number | null = null;
  let height: number | null = null;

  try {
    const meta = await sharp(buffer).metadata();
    // `sharp` reports pre-rotation dimensions; for an EXIF-rotated phone photo
    // the displayed image is the other way round, and the browser rotates it.
    // Swap so the reserved box matches what the reader will actually see.
    const rotated = meta.orientation !== undefined && meta.orientation >= 5;
    const w = meta.width ?? null;
    const h = meta.height ?? null;
    width = rotated ? h : w;
    height = rotated ? w : h;
  } catch (cause) {
    logger.warn({ err: cause }, "attachment: could not read image metadata");
    return NONE;
  }

  if (width == null || height == null) return NONE;
  if (width <= THUMB_MAX_WIDTH) {
    // Already small enough to send as-is. No thumbnail row, no second object to
    // keep in step with the original.
    return { width, height, thumbnail: null };
  }

  try {
    const thumbnail = await sharp(buffer)
      // `rotate()` with no argument applies the EXIF orientation and drops the
      // tag, so the thumbnail is upright for readers whose browser would not
      // have rotated it.
      .rotate()
      .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
      .toBuffer();
    return { width, height, thumbnail };
  } catch (cause) {
    // Measured but could not resize: keep the dimensions (still useful for the
    // reserved box) and let the reader load the full file.
    logger.warn({ err: cause }, "attachment: thumbnail generation failed, serving full image");
    return { width, height, thumbnail: null };
  }
}
