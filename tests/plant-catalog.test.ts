import { describe, it, expect } from "vitest";
import { sanitizeQuery, rankCatalogResults, type CatalogResult } from "../src/lib/plant-catalog";

const mk = (id: string, common: string | null, sci: string): CatalogResult => ({
  id,
  scientific_name: sci,
  common_name: common,
  other_common_names: null,
});

describe("sanitizeQuery", () => {
  it("trims whitespace", () => {
    expect(sanitizeQuery("  sage  ")).toBe("sage");
  });
  it("strips characters that break the .or() filter builder", () => {
    expect(sanitizeQuery("sa%ge,(x)")).toBe("sagex");
  });
});

describe("rankCatalogResults", () => {
  it("ranks prefix matches above substring-only matches", () => {
    const rows = [
      mk("1", "Cardinal Flower", "Lobelia cardinalis"), // substring 'card'
      mk("2", "Cardplant", "Aaa bbb"), // prefix 'card'
    ];
    const out = rankCatalogResults(rows, "card");
    expect(out.map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("sorts alphabetically within a tier by common name", () => {
    const rows = [
      mk("b", "Sage, White", "Salvia apiana"),
      mk("a", "Sage, Autumn", "Salvia greggii"),
    ];
    const out = rankCatalogResults(rows, "sage");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("falls back to scientific name when common name is null", () => {
    const rows = [
      mk("z", null, "Zinnia grandiflora"),
      mk("a", null, "Aquilegia canadensis"),
    ];
    const out = rankCatalogResults(rows, "a");
    expect(out.map((r) => r.id)).toEqual(["a", "z"]);
  });
});
