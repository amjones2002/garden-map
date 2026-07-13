import type { Area, AiMeta, PhotoSource, ReviewStatus, ReviewAction } from "./types";

export type ConfirmBody = {
  zone_id?: string | null;
  storage_path?: string;
  caption?: string | null;
  taken_at?: string | null;
  area?: Area | null;
  review_status?: ReviewStatus;
  source?: PhotoSource;
  ai_zone_slug?: string | null;
  ai_area?: Area | null;
  ai_confidence?: number | null;
  ai_model?: string | null;
  is_yard?: boolean | null;
  ai_meta?: AiMeta;
  gps_lat?: number | null;
  gps_lng?: number | null;
  gps_accuracy?: number | null;
  review_action?: ReviewAction | null;
};

export type ConfirmResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Map a confirm-request body to a zone_photos insert row. Always writes the base
 * columns; adds Phase 2 columns only when the caller supplies them (so the legacy
 * per-zone uploader keeps DB defaults source='manual'/review_status='confirmed').
 */
export function buildConfirmRow(body: ConfirmBody): ConfirmResult {
  if (!body.storage_path) return { ok: false, error: "storage_path required" };

  const row: Record<string, unknown> = {
    zone_id: body.zone_id ?? null,
    storage_path: body.storage_path,
    caption: body.caption?.trim() || null,
    taken_at: body.taken_at ?? null,
  };

  const optional: (keyof ConfirmBody)[] = [
    "area", "review_status", "source", "ai_zone_slug", "ai_area",
    "ai_confidence", "ai_model", "is_yard", "ai_meta",
    "gps_lat", "gps_lng", "gps_accuracy", "review_action",
  ];
  for (const key of optional) {
    if (body[key] !== undefined) row[key] = body[key];
  }

  return { ok: true, row };
}
