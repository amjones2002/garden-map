export const ZONE_PHOTOS_BUCKET = "zone-photos";

/** Public URL for an object in the public zone-photos bucket. */
export function publicPhotoUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${ZONE_PHOTOS_BUCKET}/${storagePath}`;
}

/**
 * Order photos chronologically (oldest first) by `taken_at`, falling back to
 * `uploaded_at` when a photo has no capture date — the basis for the
 * "through the seasons" timeline.
 */
export function sortChronological<T extends { taken_at: string | null; uploaded_at: string }>(
  photos: T[],
): T[] {
  const eff = (p: T) => p.taken_at ?? p.uploaded_at;
  return [...photos].sort((a, b) => eff(a).localeCompare(eff(b)));
}
