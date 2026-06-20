import { describe, it, expect } from "vitest";
import { centroid, toSvgPoints } from "../src/lib/geometry";

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
});
