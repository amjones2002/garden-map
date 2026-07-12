/** Best-effort capture date: EXIF DateTimeOriginal/CreateDate, else file mtime. */
export async function getExifDateTaken(file: File): Promise<string | null> {
  try {
    const exifr = await import("exifr");
    const result = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const d: unknown = result?.DateTimeOriginal ?? result?.CreateDate;
    if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  } catch {
    // EXIF not available — fall through
  }
  return file.lastModified ? new Date(file.lastModified).toISOString() : null;
}
