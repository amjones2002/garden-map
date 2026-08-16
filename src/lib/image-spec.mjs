/**
 * Display-copy spec — the single source of truth for what a photo looks like
 * once it lands in Supabase storage.
 *
 * Supabase storage is a *display* cache, not an archive: the batch importer's
 * local folder is the archival master, and phone uploads still live on the
 * phone. So every object in the bucket should be a downscaled copy, never an
 * original. Both write paths must agree on that shape, or the bucket refills:
 *
 *   - `scripts/import-photos.mjs` (batch, server-side, via sharp)
 *   - `src/lib/image-downscale.ts` (browser, client-side, via canvas)
 *
 * This lives in `.mjs` because it is imported from both TypeScript and the
 * `scripts/*.mjs` tooling — the same reason `zone-classifier.mjs` does.
 */

/** Long-edge cap, in pixels. Never enlarges an image that is already smaller. */
export const DISPLAY_MAX_EDGE = 1280;

/** Encoder quality, 0..1. `sharp` wants 0..100 — see DISPLAY_QUALITY_PCT. */
export const DISPLAY_QUALITY = 0.75;

/** The same quality on sharp's 0..100 scale. */
export const DISPLAY_QUALITY_PCT = Math.round(DISPLAY_QUALITY * 100);

/**
 * WebP runs ~25-35% smaller than JPEG at matching visual quality, and every
 * consumer already handles it: `next.config.ts` emits WebP exclusively, and the
 * lightbox's plain <img> has universal support.
 */
export const DISPLAY_MIME = "image/webp";

/** File extension matching DISPLAY_MIME, without the dot. */
export const DISPLAY_EXT = "webp";

/** Storage bucket holding every zone photo. */
export const ZONE_PHOTOS_BUCKET = "zone-photos";

/**
 * Fit (w, h) inside a maxEdge square, preserving aspect ratio and never
 * enlarging. Mirrors sharp's `{ fit: "inside", withoutEnlargement: true }`.
 * Pure, so the browser downscaler's sizing can be tested without a DOM.
 */
export function fitInside(width, height, maxEdge = DISPLAY_MAX_EDGE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(maxEdge / width, maxEdge / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
