import { describe, it, expect } from "vitest";
import { AREA_ORDER, AREA_LABELS, areaForZone, groupPendingByAreaZone } from "../src/lib/zones";
import type { Zone, ZonePhoto } from "../src/lib/types";

const zones = [
  { id: "z-hell", slug: "hellstrip", name: "Hellstrip", area: "front" },
  { id: "z-field", slug: "the-field", name: "The Field", area: "south" },
  { id: "z-pool", slug: "pool-spa", name: "Pool & Spa", area: "pool" },
] as unknown as Zone[];

const photo = (over: Partial<ZonePhoto>): ZonePhoto =>
  ({
    id: "p", zone_id: null, storage_path: "s", caption: null, taken_at: null,
    uploaded_at: "2024-01-01T00:00:00Z", sort_order: 0, area: null,
    review_status: "pending", source: "batch_import", source_ref: null,
    ai_zone_slug: null, ai_area: null, ai_confidence: null, ai_model: null,
    is_yard: true, ai_meta: {}, ...over,
  });

describe("AREA_ORDER / AREA_LABELS", () => {
  it("orders front, pool, south", () => expect(AREA_ORDER).toEqual(["front", "pool", "south"]));
  it("labels each area", () => expect(AREA_LABELS.front).toBe("Front"));
});

describe("areaForZone", () => {
  it("returns the zone's area", () => expect(areaForZone("z-pool", zones)).toBe("pool"));
  it("returns null for null id", () => expect(areaForZone(null, zones)).toBeNull());
  it("returns null for unknown id", () => expect(areaForZone("nope", zones)).toBeNull());
});

describe("groupPendingByAreaZone", () => {
  const photos = [
    photo({ id: "a", ai_area: "front", ai_zone_slug: "hellstrip" }),
    photo({ id: "b", ai_area: "front", ai_zone_slug: "hellstrip" }),
    photo({ id: "c", ai_area: "front", ai_zone_slug: null }),
    photo({ id: "d", ai_area: "south", ai_zone_slug: "the-field" }),
    photo({ id: "e", ai_area: null, ai_zone_slug: null }),
  ];
  const sections = groupPendingByAreaZone(photos, zones);

  it("produces a section per non-empty area in order, then a null section", () => {
    expect(sections.map((s) => s.area)).toEqual(["front", "south", null]);
  });
  it("groups zoned photos by slug with the zone name", () => {
    const front = sections.find((s) => s.area === "front")!;
    expect(front.groups[0].zoneSlug).toBe("hellstrip");
    expect(front.groups[0].zoneName).toBe("Hellstrip");
    expect(front.groups[0].zoneId).toBe("z-hell");
    expect(front.groups[0].photos.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("puts zone_slug-null photos in the area's areaOnly bucket", () => {
    const front = sections.find((s) => s.area === "front")!;
    expect(front.areaOnly.map((p) => p.id)).toEqual(["c"]);
  });
  it("labels the null-area section", () => {
    const none = sections.find((s) => s.area === null)!;
    expect(none.label).toBe("Area unknown");
    expect(none.areaOnly.map((p) => p.id)).toEqual(["e"]);
  });
  it("omits areas with no pending photos", () => {
    expect(sections.find((s) => s.area === "pool")).toBeUndefined();
  });
});
