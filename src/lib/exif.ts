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

export type Gps = { lat: number; lng: number; accuracy: number | null };

/** Normalize exifr GPS output + GPSHPositioningError into {lat,lng,accuracy}
 *  or null. Pure — unit-testable without a File. */
export function parseGps(gps: unknown, accuracyRaw?: unknown): Gps | null {
  if (!gps || typeof gps !== "object") return null;
  const g = gps as { latitude?: unknown; longitude?: unknown };
  if (typeof g.latitude !== "number" || typeof g.longitude !== "number") return null;
  if (!isFinite(g.latitude) || !isFinite(g.longitude)) return null;
  const accuracy = typeof accuracyRaw === "number" && isFinite(accuracyRaw) ? accuracyRaw : null;
  return { lat: g.latitude, lng: g.longitude, accuracy };
}

/** Best-effort camera GPS from EXIF. null when absent/unreadable. */
export async function getExifGps(file: File): Promise<Gps | null> {
  try {
    const exifr = await import("exifr");
    const gps = await exifr.gps(file);
    const meta = await exifr.parse(file, ["GPSHPositioningError"]).catch(() => null);
    return parseGps(gps, meta?.GPSHPositioningError);
  } catch {
    return null;
  }
}
