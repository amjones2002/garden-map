import { describe, it, expect } from "vitest";
import { centroid, toSvgPoints, normalizeShape, visualCenter, fitLabel } from "../src/lib/geometry";

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

  it("visualCenter of a unit square is near its center", () => {
    const c = visualCenter([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(c.x).toBeCloseTo(0.5, 1);
    expect(c.y).toBeCloseTo(0.5, 1);
  });

  it("visualCenter of an L-shaped polygon lands inside the shape", () => {
    // L-shape: full bottom strip + left column. The corner-average (centroid)
    // falls in the empty notch (top-right); visualCenter must be inside the ink.
    const L: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.4 },
      { x: 0.4, y: 0.4 },
      { x: 0.4, y: 1 },
      { x: 0, y: 1 },
    ];
    const c = visualCenter(L);
    // Point-in-polygon check via ray casting.
    let inside = false;
    for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
      const intersect =
        (L[i].y > c.y) !== (L[j].y > c.y) &&
        c.x < ((L[j].x - L[i].x) * (c.y - L[i].y)) / (L[j].y - L[i].y) + L[i].x;
      if (intersect) inside = !inside;
    }
    expect(inside).toBe(true);
  });

  it("visualCenter falls back to centroid for < 3 points", () => {
    expect(visualCenter([{ x: 0.2, y: 0.3 }])).toEqual({ x: 0.2, y: 0.3 });
    expect(visualCenter([])).toEqual({ x: 0, y: 0 });
  });

  it("fitLabel keeps a short name on one line at the cap size in a wide box", () => {
    const r = fitLabel("North Side", 300, 60);
    expect(r.lines).toEqual(["North Side"]);
    expect(r.fontSize).toBe(34);
  });

  it("fitLabel wraps a long multi-word name to two balanced lines in a narrow box", () => {
    const r = fitLabel("Front Street Beds", 120, 220);
    expect(r.lines.length).toBe(2);
    expect(r.lines.join(" ")).toBe("Front Street Beds");
    // Two lines let the font stay larger than cramming onto one line would.
    expect(r.fontSize).toBeGreaterThan(fitLabel("Front Street Beds", 120, 20).fontSize);
  });

  it("fitLabel shrinks a single long word (cannot wrap) to fit width", () => {
    const r = fitLabel("Driveway", 60, 200);
    expect(r.lines).toEqual(["Driveway"]);
    expect(r.fontSize).toBeLessThan(34);
    expect(r.fontSize).toBeGreaterThanOrEqual(13);
  });

  it("fitLabel never goes below the floor and never returns empty lines", () => {
    const r = fitLabel("Field Bed + Vines", 30, 20);
    expect(r.fontSize).toBe(13);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines.every((l) => l.length > 0)).toBe(true);
  });

  it("fitLabel handles blank text", () => {
    const r = fitLabel("   ", 100, 100);
    expect(r.lines.length).toBe(1);
    expect(r.fontSize).toBe(13);
  });
});
