import { readdir, stat } from "node:fs/promises";
import { join, extname, relative, sep } from "node:path";
import sharp from "sharp";
import exifr from "exifr";

export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

/** Recursively collect image file paths under `dir`. */
export async function walkImages(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkImages(full)));
    } else if (IMAGE_EXTS.has(extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** Extract a YYYYMMDD date embedded in a filename, or null. */
export function parseFilenameDate(name) {
  const m = name.match(/(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = +y, month = +mo, day = +d;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Capture date: EXIF DateTimeOriginal → filename date → file mtime. */
export async function extractCaptureDate(filePath, buffer) {
  try {
    const exif = await exifr.parse(buffer, ["DateTimeOriginal", "CreateDate"]);
    const dt = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) return { date: dt, source: "exif" };
  } catch {
    // no/invalid EXIF — fall through
  }
  const fromName = parseFilenameDate(filePath.split(sep).pop() ?? "");
  if (fromName) return { date: fromName, source: "filename" };
  const st = await stat(filePath);
  return { date: st.mtime, source: "mtime" };
}

/** Resize to maxEdge (long edge), auto-orient, strip EXIF, encode JPEG. */
export async function downscale(buffer, { maxEdge, quality }) {
  return sharp(buffer)
    .rotate() // apply EXIF orientation, then metadata is dropped on output
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/** Stable per-photo identifier: POSIX relative path from the import root. */
export function sourceRefFor(rootDir, filePath) {
  return relative(rootDir, filePath).split(sep).join("/");
}
