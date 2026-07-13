import type { Area, Zone } from "./types";
import { areaForZone } from "./zones";

export type ReviewAction = "confirm" | "reassign" | "reject";

export type ReviewPlan =
  | { ok: true; patch: { review_status: "confirmed" | "rejected"; zone_id?: string; area?: Area | null; review_action: "confirmed_asis" | "reassigned" | "rejected" } }
  | { ok: false; error: string };

/**
 * Validate a review action and produce the DB patch. Confirm and reassign both
 * require a zone that exists (a confirmed photo must have a bed — this guards the
 * area-only case); reject needs nothing. Pure — the route applies the patch.
 */
export function planReviewUpdate(input: {
  action: ReviewAction;
  zoneId?: string | null;
  zones: Zone[];
}): ReviewPlan {
  const { action, zoneId, zones } = input;

  if (action === "reject") {
    return { ok: true, patch: { review_status: "rejected", review_action: "rejected" } };
  }

  if (action === "confirm" || action === "reassign") {
    if (!zoneId) return { ok: false, error: "a zone_id is required to confirm a photo" };
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return { ok: false, error: `unknown zone_id: ${zoneId}` };
    return {
      ok: true,
      patch: {
        review_status: "confirmed",
        zone_id: zoneId,
        area: areaForZone(zoneId, zones),
        review_action: action === "confirm" ? "confirmed_asis" : "reassigned",
      },
    };
  }

  return { ok: false, error: `unknown action: ${String(action)}` };
}
