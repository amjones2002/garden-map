import { describe, it, expect } from "vitest";
import { buildConfirmRow } from "../src/lib/zone-photos-write";

describe("buildConfirmRow", () => {
  it("errors without a storage_path", () => {
    const r = buildConfirmRow({ zone_id: "z1" });
    expect(r.ok).toBe(false);
  });

  it("maps a legacy manual body (no AI fields) and omits AI keys", () => {
    const r = buildConfirmRow({ zone_id: "z1", storage_path: "z1/a.jpg", caption: "  hi  ", taken_at: "2024-06-01T00:00:00Z" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.zone_id).toBe("z1");
      expect(r.row.storage_path).toBe("z1/a.jpg");
      expect(r.row.caption).toBe("hi");
      expect(r.row.taken_at).toBe("2024-06-01T00:00:00Z");
      expect("ai_zone_slug" in r.row).toBe(false);
      expect("review_status" in r.row).toBe(false);
    }
  });

  it("trims an empty caption to null", () => {
    const r = buildConfirmRow({ zone_id: "z1", storage_path: "s", caption: "   " });
    if (r.ok) expect(r.row.caption).toBeNull();
  });

  it("persists Phase 2 fields when present", () => {
    const r = buildConfirmRow({
      zone_id: "z1", storage_path: "_inbox/x.jpg", area: "pool",
      review_status: "confirmed", source: "manual",
      ai_zone_slug: "pool-spa", ai_area: "pool", ai_confidence: 0.84, ai_model: "claude-sonnet-4-6",
      is_yard: true, ai_meta: { reasoning: "brick", plants: ["salvia"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.area).toBe("pool");
      expect(r.row.review_status).toBe("confirmed");
      expect(r.row.source).toBe("manual");
      expect(r.row.ai_zone_slug).toBe("pool-spa");
      expect(r.row.ai_confidence).toBe(0.84);
      expect((r.row.ai_meta as { plants: string[] }).plants).toEqual(["salvia"]);
    }
  });

  it("allows a null zone_id (area-only)", () => {
    const r = buildConfirmRow({ zone_id: null, storage_path: "s", area: "front", review_status: "pending" });
    if (r.ok) expect(r.row.zone_id).toBeNull();
  });
});
