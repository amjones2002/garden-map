import { describe, it, expect } from "vitest";
import { MILESTONE_KEYS, MILESTONES, seasonYear, assignEra } from "../src/lib/eras.mjs";

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
