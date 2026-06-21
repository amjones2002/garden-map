import { describe, it, expect } from "vitest";
import { centroid, toSvgPoints, normalizeShape } from "../src/lib/geometry";

describe("geometry", () => {
  it("centroid of a unit square is its center", () => {
    const c = centroid([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
  });

  it("centroid of empty returns 0,0", () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });

  it("toSvgPoints scales normalized coords by size", () => {
    const s = toSvgPoints([{ x: 0, y: 0 }, { x: 0.5, y: 1 }], 1000);
    expect(s).toBe("0,0 500,1000");
  });

  it("normalizeShape scales down, rounds to 4dp, and clamps to [0,1]", () => {
    const out = normalizeShape([{ x: 250, y: 500 }, { x: 1200, y: -30 }, { x: 333, y: 333 }], 1000);
    expect(out[0]).toEqual({ x: 0.25, y: 0.5 });
    expect(out[1]).toEqual({ x: 1, y: 0 }); // clamped
    expect(out[2]).toEqual({ x: 0.333, y: 0.333 });
  });
});
