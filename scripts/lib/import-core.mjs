import { MODEL } from "../../src/lib/zone-classifier.mjs";

export const THRESHOLD_DEFAULT = 0.7;

/** Confirmed only when we have a zone slug at/above the confidence threshold. */
export function decideReviewStatus({ zoneSlug, confidence, threshold }) {
  return zoneSlug && confidence >= threshold ? "confirmed" : "pending";
}

/**
 * Map one classification + manifest entry to an import decision.
 * Returns { skip, reason, row }. zone_id and storage_path are resolved by the
 * orchestrator (they require the DB and storage); everything else is here.
 */
export function buildImportRecord({ classification: c, captureDate, captureSource, sourceRef, threshold }) {
  if (!c.is_yard) return { skip: true, reason: "not_yard" };

  const review_status = decideReviewStatus({
    zoneSlug: c.zone_slug, confidence: c.confidence, threshold,
  });

  return {
    skip: false,
    reason: null,
    row: {
      area: c.area,
      ai_zone_slug: c.zone_slug,
      ai_area: c.area,
      ai_confidence: c.confidence,
      ai_model: MODEL,
      caption: c.caption || null,
      is_yard: true,
      taken_at: captureDate.toISOString(),
      source: "batch_import",
      source_ref: sourceRef,
      review_status,
      ai_meta: {
        quality: c.quality,
        reasoning: c.reasoning,
        tags: c.tags,
        plants: c.plants,
        hardscape: c.hardscape,
        botanical: c.botanical,
        capture_source: captureSource,
      },
    },
  };
}
