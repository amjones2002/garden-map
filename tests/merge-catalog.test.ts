import { describe, it, expect } from "vitest";
import { mergeCatalog } from "../scripts/lib/merge-catalog.mjs";

const npsot = [
  { scientific_name: "Acacia angustissima", common_name: "Prairie Acacia", ecoregions: [], source: "npsot.org" },
  { scientific_name: "Abronia ameliae", common_name: "Heart's Delight", ecoregions: [], source: "npsot.org" },
];
const wild = [
  { scientific_name: "Acacia angustissima", common_name: "Prairie Acacia", ecoregion: "Cross Timbers" },
  { scientific_name: "acacia angustissima", common_name: "Prairie Acacia", ecoregion: "Texas Blackland Prairies" },
  { scientific_name: "Acacia angustissima", common_name: "Prairie Acacia", ecoregion: "Cross Timbers" }, // dup
  { scientific_name: "Some other sp.", common_name: "X", ecoregion: "High Plains" },
];

describe("mergeCatalog", () => {
  it("attaches deduped, sorted ecoregions by case-insensitive name match", () => {
    const out = mergeCatalog(npsot, wild);
    const acacia = out.find((r) => r.scientific_name === "Acacia angustissima");
    expect(acacia.ecoregions).toEqual(["Cross Timbers", "Texas Blackland Prairies"]);
  });

  it("leaves unmatched NPSOT rows with empty ecoregions", () => {
    const out = mergeCatalog(npsot, wild);
    const abronia = out.find((r) => r.scientific_name === "Abronia ameliae");
    expect(abronia.ecoregions).toEqual([]);
  });

  it("does not add wildflower-only species to the catalog", () => {
    const out = mergeCatalog(npsot, wild);
    expect(out.find((r) => r.scientific_name === "Some other sp.")).toBeUndefined();
    expect(out).toHaveLength(2);
  });
});
