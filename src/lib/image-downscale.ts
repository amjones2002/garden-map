import {
  DISPLAY_MAX_EDGE,
  DISPLAY_QUALITY,
  DISPLAY_MIME,
  DISPLAY_EXT,
  fitInside,
} from "./image-spec.mjs";

export { fitInside };

/** Swap a filename's extension for the display-copy one. */
export function displayFilename(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.${DISPLAY_EXT}`;
}

/**
 * Downscale an image to the display-copy spec (see `image-spec.mjs`) before it
 * is uploaded. Phone originals run 2-5 MB; the display copy is a few hundred KB.
 *
 * Canvas encoding drops EXIF, so callers must read capture date and GPS from the
 * *original* File first and carry them alongside — see `UploadTab`.
 *
 * Best-effort by design: returns the original File untouched if the browser
 * can't decode it (HEIC outside Safari) or can't encode WebP. A photo that
 * uploads large beats a photo that fails to upload.
 */
export async function downscaleForUpload(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitInside(bitmap.width, bitmap.height, DISPLAY_MAX_EDGE);
    if (width === 0 || height === 0) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, DISPLAY_MIME, DISPLAY_QUALITY),
    );
    // A browser that ignores the WebP request hands back a PNG, which can be
    // *larger* than the JPEG we started with. Only take the win.
    if (!blob || blob.type !== DISPLAY_MIME || blob.size >= file.size) return file;

    return new File([blob], displayFilename(file.name), {
      type: DISPLAY_MIME,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
