import { describe, it, expect } from "vitest";
import { gpsPriorText } from "../src/lib/zone-classifier.mjs";

describe("gpsPriorText", () => {
  it("names the area and shortlist", () => {
    const s = gpsPriorText({ area: "south", shortlist: ["raised-bed", "dry-mineral-bed"] });
    expect(s).toContain("SOUTH");
    expect(s).toContain("raised-bed");
    expect(s).toContain("dry-mineral-bed");
  });
  it("returns empty string for a null/empty hint", () => {
    expect(gpsPriorText(null)).toBe("");
    expect(gpsPriorText({ area: null, shortlist: [] })).toBe("");
  });
  it("handles an area with no shortlist", () => {
    const s = gpsPriorText({ area: "front", shortlist: [] });
    expect(s).toContain("FRONT");
  });
});
