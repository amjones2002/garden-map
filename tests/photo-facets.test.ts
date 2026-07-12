import { describe, it, expect } from "vitest";
import { normalizeBloomColor, CANONICAL_COLORS } from "../src/lib/photo-facets";
import { deriveFacet, matchesFilters, availableFacets, EMPTY_FILTERS } from "../src/lib/photo-facets";
import type { Zone, ZonePhoto } from "../src/lib/types";
import type { EraContent } from "../src/lib/eras.data";

describe("normalizeBloomColor", () => {
  it("maps exact canonical names", () => {
    expect(normalizeBloomColor("pink")).toBe("pink");
    expect(normalizeBloomColor("Purple")).toBe("purple");
  });
  it("maps variants via keywords", () => {
    expect(normalizeBloomColor("light pink")).toBe("pink");
    expect(normalizeBloomColor("deep reddish-purple")).toBe("purple");
    expect(normalizeBloomColor("pale yellow / cream")).toBe("yellow");
    expect(normalizeBloomColor("lavender")).toBe("purple");
  });
  it("returns null for empty / none / unmappable noise", () => {
    expect(normalizeBloomColor("")).toBeNull();
    expect(normalizeBloomColor("none")).toBeNull();
    expect(normalizeBloomColor("n/a")).toBeNull();
    expect(normalizeBloomColor("variegated foliage")).toBeNull();
  });
  it("exposes a swatch hex for every canonical color", () => {
    for (const c of CANONICAL_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

const zones = [{ id: "z-pool", slug: "pool-spa", name: "Pool & Spa", area: "pool" }] as unknown as Zone[];
const eras: EraContent[] = [
  { key: "era-0", title: "Before", blurb: "", milestones: [], start: "2024-01-01", end: "2025-04-13", coverPath: null, generatedAt: "", model: "" },
  { key: "era-1", title: "Build-Out", blurb: "", milestones: ["raised_beds"], start: "2025-04-13", end: null, coverPath: null, generatedAt: "", model: "" },
];
const photo = (over: Partial<ZonePhoto>): ZonePhoto =>
  ({ id: "p", zone_id: "z-pool", storage_path: "z-pool/a.jpg", caption: "pink salvia by the pool",
     taken_at: "2025-05-01T00:00:00Z", uploaded_at: "2025-05-02T00:00:00Z", sort_order: 0, area: "pool",
     review_status: "confirmed", source: "batch_import", source_ref: null, ai_zone_slug: "pool-spa",
     ai_area: "pool", ai_confidence: 0.9, ai_model: "m", is_yard: true,
     ai_meta: { quality: "good", reasoning: "kidney pool", tags: ["pool"], plants: ["salvia"],
       hardscape: { raised_beds: true, stock_tank: false, cedar_planters: false, vines: false, cover_crop_field: false },
       botanical: { bloom_colors: ["light pink"] } }, ...over }) as ZonePhoto;

describe("deriveFacet", () => {
  const f = deriveFacet(photo({}), zones, eras);
  it("resolves zone, area, quality, bloom, milestone, era, season", () => {
    expect(f.zoneName).toBe("Pool & Spa");
    expect(f.quality).toBe("good");
    expect(f.bloomColors).toEqual(["pink"]);
    expect(f.milestones).toEqual(["raised_beds"]);
    expect(f.eraKey).toBe("era-1");
    expect(f.season).toBe("spring");
    expect(f.year).toBe(2025);
  });
  it("builds a lowercased searchText from caption + tags + plants", () => {
    expect(f.searchText).toContain("salvia");
    expect(f.searchText).toContain("pool");
  });
  it("tolerates empty ai_meta", () => {
    const g = deriveFacet(photo({ ai_meta: {} }), zones, eras);
    expect(g.bloomColors).toEqual([]);
    expect(g.milestones).toEqual([]);
    expect(g.quality).toBeNull();
  });
});

describe("matchesFilters", () => {
  const f = deriveFacet(photo({}), zones, eras);
  it("passes with empty filters", () => expect(matchesFilters(f, EMPTY_FILTERS)).toBe(true));
  it("filters by area (AND across dimensions)", () => {
    expect(matchesFilters(f, { ...EMPTY_FILTERS, areas: ["pool"] })).toBe(true);
    expect(matchesFilters(f, { ...EMPTY_FILTERS, areas: ["front"] })).toBe(false);
  });
  it("filters by bloom (OR within a dimension)", () => {
    expect(matchesFilters(f, { ...EMPTY_FILTERS, bloom: ["pink", "red"] })).toBe(true);
    expect(matchesFilters(f, { ...EMPTY_FILTERS, bloom: ["blue"] })).toBe(false);
  });
  it("filters by free text over searchText", () => {
    expect(matchesFilters(f, { ...EMPTY_FILTERS, text: "salvia" })).toBe(true);
    expect(matchesFilters(f, { ...EMPTY_FILTERS, text: "cactus" })).toBe(false);
  });
});

describe("availableFacets", () => {
  it("counts distinct values per dimension", () => {
    const facets = [deriveFacet(photo({ id: "a" }), zones, eras), deriveFacet(photo({ id: "b" }), zones, eras)];
    const a = availableFacets(facets);
    expect(a.areas).toEqual([{ value: "pool", count: 2 }]);
    expect(a.bloom).toEqual([{ value: "pink", count: 2 }]);
    expect(a.eras.find((e) => e.value === "era-1")?.count).toBe(2);
  });
});
