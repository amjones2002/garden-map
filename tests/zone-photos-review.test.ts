import { describe, it, expect } from "vitest";
import { planReviewUpdate } from "../src/lib/zone-photos-review";
import type { Zone } from "../src/lib/types";

const zones = [
  { id: "z-hell", slug: "hellstrip", name: "Hellstrip", area: "front" },
  { id: "z-pool", slug: "pool-spa", name: "Pool & Spa", area: "pool" },
] as unknown as Zone[];

describe("planReviewUpdate", () => {
  it("reject sets rejected, no zone change", () => {
    expect(planReviewUpdate({ action: "reject", zones })).toEqual({
      ok: true, patch: { review_status: "rejected", review_action: "rejected" },
    });
  });
  it("confirm with a valid zone sets confirmed + zone + derived area", () => {
    expect(planReviewUpdate({ action: "confirm", zoneId: "z-hell", zones })).toEqual({
      ok: true,
      patch: { review_status: "confirmed", zone_id: "z-hell", area: "front", review_action: "confirmed_asis" },
    });
  });
  it("reassign with a valid zone sets confirmed + zone + derived area", () => {
    expect(planReviewUpdate({ action: "reassign", zoneId: "z-pool", zones })).toEqual({
      ok: true,
      patch: { review_status: "confirmed", zone_id: "z-pool", area: "pool", review_action: "reassigned" },
    });
  });
  it("confirm without a zone is an error (guards area-only)", () => {
    const r = planReviewUpdate({ action: "confirm", zoneId: null, zones });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zone/i);
  });
  it("reassign to an unknown zone is an error", () => {
    const r = planReviewUpdate({ action: "reassign", zoneId: "nope", zones });
    expect(r.ok).toBe(false);
  });
  it("unknown action is an error", () => {
    const r = planReviewUpdate({ action: "bogus" as never, zones });
    expect(r.ok).toBe(false);
  });
});
