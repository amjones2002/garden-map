import { describe, it, expect } from "vitest";
import {
  polygonCentroid, pointInPolygon, fitAffine, applyAffine, resolveGpsHint, filterPlotOutliers,
} from "../src/lib/georeference.mjs";

const unitSquare = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

describe("polygonCentroid", () => {
  it("returns the centre of a unit square", () => {
    const c = polygonCentroid(unitSquare);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
  });
  it("falls back to vertex mean for a degenerate 2-point shape", () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("pointInPolygon", () => {
  it("detects inside and outside", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, unitSquare)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, unitSquare)).toBe(false);
  });
});

describe("fitAffine", () => {
  // A known transform on realistic garden-plot coordinates (~0.0003 deg wide).
  const tx = (lat: number, lng: number) => ({ x: 0.5 * lng + 100.25, y: -0.5 * lat + 16.0 });
  const pts = [
    { lat: 32.9000, lng: -96.7000, zoneId: "a" },
    { lat: 32.9001, lng: -96.7001, zoneId: "b" },
    { lat: 32.9002, lng: -96.7002, zoneId: "c" },
    { lat: 32.9003, lng: -96.7000, zoneId: "a" },
    { lat: 32.9004, lng: -96.7001, zoneId: "b" },
    { lat: 32.9005, lng: -96.7002, zoneId: "c" },
    { lat: 32.9006, lng: -96.7003, zoneId: "a" },
    { lat: 32.9007, lng: -96.7004, zoneId: "b" },
  ].map((p) => ({ ...p, ...tx(p.lat, p.lng) }));

  it("recovers the transform from clean control points", () => {
    const t = fitAffine(pts);
    expect(t).not.toBeNull();
    const q = applyAffine(t!, 32.90025, -96.70015);
    const expected = tx(32.90025, -96.70015);
    expect(q.x).toBeCloseTo(expected.x, 4);
    expect(q.y).toBeCloseTo(expected.y, 4);
    expect(t!.rms).toBeLessThan(1e-6);
    expect(t!.n).toBe(8);
  });

  it("returns null with too few points", () => {
    expect(fitAffine(pts.slice(0, 5))).toBeNull();
  });

  it("returns null when fewer than 3 distinct zones", () => {
    const twoZones = pts.map((p, i) => ({ ...p, zoneId: i % 2 ? "a" : "b" }));
    expect(fitAffine(twoZones)).toBeNull();
  });
});

describe("resolveGpsHint", () => {
  // Identity transform so lat/lng ARE map coords for the test.
  const identity = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
  const zones = [
    { slug: "front-a", area: "front", shape: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0, y: 0.2 }] },
    { slug: "front-b", area: "front", shape: [{ x: 0.3, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.2 }, { x: 0.3, y: 0.2 }] },
    { slug: "south-a", area: "south", shape: [{ x: 0, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.2, y: 1 }, { x: 0, y: 1 }] },
  ];

  it("resolves area by containment and shortlists nearest beds in that area", () => {
    // lng=0.1, lat=0.1 sits inside front-a.
    const hint = resolveGpsHint(identity, 0.1, 0.1, zones as never);
    expect(hint).not.toBeNull();
    expect(hint!.area).toBe("front");
    expect(hint!.shortlist[0]).toBe("front-a");
    expect(hint!.shortlist).not.toContain("south-a");
  });

  it("falls back to nearest zone's area when no polygon contains the point", () => {
    // lng=0.9, lat=0.9 is outside all beds; nearest centroid is south-a.
    const hint = resolveGpsHint(identity, 0.9, 0.9, zones as never);
    expect(hint!.area).toBe("south");
  });
});

describe("filterPlotOutliers", () => {
  // A tight on-plot cluster (~0.25 acre near 32.9335 / -96.6852) plus one
  // photo taken 6 km away — the kind of off-site fix that would otherwise
  // dominate the least-squares affine fit.
  const cluster = [
    { lat: 32.933500, lng: -96.685200, zoneId: "a" },
    { lat: 32.933520, lng: -96.685180, zoneId: "b" },
    { lat: 32.933480, lng: -96.685220, zoneId: "c" },
    { lat: 32.933510, lng: -96.685190, zoneId: "a" },
    { lat: 32.933490, lng: -96.685210, zoneId: "b" },
  ];
  const offsite = { lat: 32.98980, lng: -96.71610, zoneId: "d" }; // ~6 km north

  it("drops a km-scale outlier and keeps the on-plot cluster", () => {
    const kept = filterPlotOutliers([...cluster, offsite]);
    expect(kept).toHaveLength(cluster.length);
    expect(kept).not.toContainEqual(offsite);
  });

  it("keeps every point when all are within the radius", () => {
    expect(filterPlotOutliers(cluster)).toHaveLength(cluster.length);
  });

  it("respects a custom maxMeters", () => {
    // A point ~30 m out survives the default 100 m but not a tight 10 m.
    const near = { lat: 32.93350 + 30 / 111320, lng: -96.68520, zoneId: "e" };
    expect(filterPlotOutliers([...cluster, near], 100)).toHaveLength(cluster.length + 1);
    expect(filterPlotOutliers([...cluster, near], 10)).toHaveLength(cluster.length);
  });

  it("returns an empty array unchanged", () => {
    expect(filterPlotOutliers([])).toEqual([]);
  });
});
