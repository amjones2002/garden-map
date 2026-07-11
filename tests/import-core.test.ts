import { describe, it, expect } from "vitest";
import {
  THRESHOLD_DEFAULT,
  decideReviewStatus,
  buildImportRecord,
} from "../scripts/lib/import-core.mjs";

const base = {
  captureDate: new Date("2024-06-15T12:00:00Z"),
  captureSource: "exif" as const,
  sourceRef: "sub/img.jpg",
  threshold: THRESHOLD_DEFAULT,
};

const cls = (over: Record<string, unknown> = {}) => ({
  is_yard: true, quality: "good", area: "front", zone_slug: "stock-tank",
  confidence: 0.9, reasoning: "brick + oak", caption: "cap",
  tags: ["t"], plants: ["milkweed"],
  hardscape: { stock_tank: true }, botanical: { bloom_colors: ["orange"] },
  ...over,
});

describe("decideReviewStatus", () => {
  it("confirms a confident zone match", () => {
    expect(decideReviewStatus({ zoneSlug: "stock-tank", confidence: 0.8, threshold: 0.7 })).toBe("confirmed");
  });
  it("queues a low-confidence match", () => {
    expect(decideReviewStatus({ zoneSlug: "stock-tank", confidence: 0.5, threshold: 0.7 })).toBe("pending");
  });
  it("queues an area-only result (no zone slug)", () => {
    expect(decideReviewStatus({ zoneSlug: null, confidence: 0.99, threshold: 0.7 })).toBe("pending");
  });
});

describe("buildImportRecord", () => {
  it("skips non-yard photos", () => {
    const r = buildImportRecord({ classification: cls({ is_yard: false }), ...base });
    expect(r.skip).toBe(true);
    expect(r.reason).toBe("not_yard");
    expect(r.row).toBeUndefined();
  });

  it("builds a confirmed row for a confident zone match", () => {
    const r = buildImportRecord({ classification: cls(), ...base });
    expect(r.skip).toBe(false);
    expect(r.row.review_status).toBe("confirmed");
    expect(r.row.ai_zone_slug).toBe("stock-tank");
    expect(r.row.area).toBe("front");
    expect(r.row.source).toBe("batch_import");
    expect(r.row.source_ref).toBe("sub/img.jpg");
    expect(r.row.taken_at).toBe(base.captureDate.toISOString());
  });

  it("preserves plants and enrichment in ai_meta", () => {
    const r = buildImportRecord({ classification: cls(), ...base });
    expect(r.row.ai_meta.plants).toEqual(["milkweed"]);
    expect(r.row.ai_meta.hardscape.stock_tank).toBe(true);
    expect(r.row.ai_meta.capture_source).toBe("exif");
  });

  it("queues an area-only row with null zone slug", () => {
    const r = buildImportRecord({ classification: cls({ zone_slug: null, area: "pool" }), ...base });
    expect(r.skip).toBe(false);
    expect(r.row.review_status).toBe("pending");
    expect(r.row.ai_zone_slug).toBeNull();
    expect(r.row.area).toBe("pool");
  });
});

describe("THRESHOLD_DEFAULT", () => {
  it("is 0.7", () => expect(THRESHOLD_DEFAULT).toBe(0.7));
});
