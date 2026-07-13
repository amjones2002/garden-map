import { describe, it, expect } from "vitest";
import { AREA_ORDER, AREA_LABELS, areaForZone, groupPendingByAreaZone, bedsAvailableAt } from "../src/lib/zones";
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

describe("bedsAvailableAt", () => {
  const zone = (slug: string, established_at: string | null): Zone =>
    ({ id: slug, slug, name: slug, area: "front", established_at } as unknown as Zone);

  it("includes zones with a null established_at (permanent / predates record)", () => {
    const zs = [zone("front-yard", null)];
    expect(bedsAvailableAt(zs, "2024-01-01T00:00:00Z").map((z) => z.slug)).toEqual(["front-yard"]);
  });

  it("includes every zone when takenAt is null (undatable photo)", () => {
    const zs = [zone("front-yard", null), zone("stock-tank", "2025-04-01")];
    expect(bedsAvailableAt(zs, null).map((z) => z.slug)).toEqual(["front-yard", "stock-tank"]);
  });

  it("excludes a bed whose established_at is after the photo's taken_at", () => {
    const zs = [zone("stock-tank", "2025-04-01")];
    expect(bedsAvailableAt(zs, "2024-11-02T16:30:36Z")).toEqual([]);
  });

  it("includes a bed established on the same calendar day as the photo", () => {
    const zs = [zone("stock-tank", "2025-04-13")];
    expect(bedsAvailableAt(zs, "2025-04-13T20:08:29Z").map((z) => z.slug)).toEqual(["stock-tank"]);
  });

  it("includes a bed established before the photo's taken_at", () => {
    const zs = [zone("stock-tank", "2025-04-01")];
    expect(bedsAvailableAt(zs, "2025-06-01T00:00:00Z").map((z) => z.slug)).toEqual(["stock-tank"]);
  });

  it("filters a mixed set, preserving input order", () => {
    const zs = [
      zone("front-yard", null),        // permanent → kept
      zone("stock-tank", "2025-04-01"), // future → dropped
      zone("hellstrip", "2025-01-01"),  // past → kept
    ];
    expect(bedsAvailableAt(zs, "2025-02-01T00:00:00Z").map((z) => z.slug)).toEqual(["front-yard", "hellstrip"]);
  });
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
