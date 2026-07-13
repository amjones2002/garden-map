import { describe, it, expect } from "vitest";
import { MILESTONE_KEYS, MILESTONES, seasonYear, assignEra } from "../src/lib/eras.mjs";
import { detectMilestoneArrivals, buildEras, groupBySeason, defaultEraTitle } from "../src/lib/eras.mjs";

describe("era primitives", () => {
  it("enumerates the five hardscape milestones with labels + icons", () => {
    expect(MILESTONE_KEYS).toContain("raised_beds");
    expect(MILESTONE_KEYS).toHaveLength(5);
    expect(MILESTONES.find((m) => m.key === "raised_beds")?.label).toBeTruthy();
  });

  it("derives season and year from a date", () => {
    expect(seasonYear("2025-04-13T00:00:00Z")).toEqual({ season: "spring", year: 2025 });
    expect(seasonYear("2024-12-05T00:00:00Z")).toEqual({ season: "winter", year: 2024 });
    expect(seasonYear("2025-07-01T00:00:00Z")).toEqual({ season: "summer", year: 2025 });
    expect(seasonYear("2024-10-17T00:00:00Z")).toEqual({ season: "fall", year: 2024 });
  });

  it("assigns a date to the era whose [start,end) contains it", () => {
    const eras = [
      { key: "era-0", start: "2024-10-01", end: "2025-04-13" },
      { key: "era-1", start: "2025-04-13", end: null },
    ];
    expect(assignEra("2024-11-01", eras)).toBe("era-0");
    expect(assignEra("2025-04-13", eras)).toBe("era-1");
    expect(assignEra("2026-01-01", eras)).toBe("era-1");
  });

  it("returns null when there are no eras", () => {
    expect(assignEra("2025-01-01", [])).toBeNull();
  });
});

const mk = (taken_at: string, flags: Record<string, boolean> = {}) => ({
  taken_at, uploaded_at: taken_at,
  ai_meta: { hardscape: { stock_tank: false, raised_beds: false, cedar_planters: false, vines: false, cover_crop_field: false, ...flags } },
});

describe("detectMilestoneArrivals", () => {
  it("returns the first sustained date and ignores a lone early outlier", () => {
    const photos = [
      mk("2024-11-01", { raised_beds: true }),          // lone false positive
      mk("2025-04-13", { raised_beds: true }),
      mk("2025-04-20", { raised_beds: true }),
      mk("2025-05-01", { raised_beds: true }),
    ];
    const arr = detectMilestoneArrivals(photos);
    expect(arr.raised_beds).toBe("2025-04-13");
  });
  it("returns null for a milestone that never sustains", () => {
    const arr = detectMilestoneArrivals([mk("2025-01-01", { vines: true })]);
    expect(arr.vines).toBeNull();
  });
});

describe("buildEras", () => {
  const photos = [
    mk("2024-10-17"),
    mk("2025-04-13", { raised_beds: true }), mk("2025-04-14", { raised_beds: true, stock_tank: true }),
    mk("2025-04-20", { raised_beds: true, stock_tank: true }),
    mk("2025-05-18", { cover_crop_field: true }), mk("2025-05-25", { cover_crop_field: true }),
    mk("2025-06-01", { cover_crop_field: true }),
  ];
  const eras = buildEras(photos);
  it("starts with a pre-build era from the earliest photo", () => {
    expect(eras[0].start).toBe("2024-10-17");
    expect(eras[0].milestones).toEqual([]);
  });
  it("bundles same-window arrivals into one boundary", () => {
    expect(eras[1].milestones.sort()).toEqual(["raised_beds", "stock_tank"]);
  });
  it("ends the last era open", () => {
    expect(eras[eras.length - 1].end).toBeNull();
  });
  it("produces a deterministic fallback title", () => {
    expect(defaultEraTitle(eras[0])).toMatch(/before/i);
    expect(defaultEraTitle(eras[1]).toLowerCase()).toContain("raised beds");
  });
});

describe("groupBySeason", () => {
  it("groups chronologically by season+year", () => {
    const groups = groupBySeason([mk("2025-05-01"), mk("2025-07-01"), mk("2024-11-01")]);
    expect(groups.map((g) => g.key)).toEqual(["fall-2024", "spring-2025", "summer-2025"]);
  });
});
