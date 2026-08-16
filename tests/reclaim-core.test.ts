import { describe, it, expect } from "vitest";
import { checkOrphanShare, ORPHAN_SHARE_LIMIT } from "../scripts/lib/reclaim-core.mjs";

describe("checkOrphanShare", () => {
  it("passes the realistic case: a handful of skipped uploads", () => {
    const r = checkOrphanShare({ orphanCount: 16, totalObjects: 2924 });
    expect(r.ok).toBe(true);
    expect(r.forced).toBe(false);
  });

  it("passes when there are no orphans at all", () => {
    expect(checkOrphanShare({ orphanCount: 0, totalObjects: 2924 }).ok).toBe(true);
  });

  it("blocks the path-matching regression that would delete the library", () => {
    const r = checkOrphanShare({ orphanCount: 2924, totalObjects: 2924 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/storage paths stopped matching/);
  });

  it("blocks a share just above the ceiling", () => {
    expect(checkOrphanShare({ orphanCount: 21, totalObjects: 100 }).ok).toBe(false);
  });

  it("allows a share exactly at the ceiling", () => {
    const r = checkOrphanShare({ orphanCount: 20, totalObjects: 100 });
    expect(r.ok).toBe(true);
    expect(r.share).toBeCloseTo(ORPHAN_SHARE_LIMIT);
  });

  it("lets --force override, and flags that it did", () => {
    const r = checkOrphanShare({ orphanCount: 2924, totalObjects: 2924, force: true });
    expect(r.ok).toBe(true);
    expect(r.forced).toBe(true);
  });

  it("honours a custom limit", () => {
    expect(checkOrphanShare({ orphanCount: 30, totalObjects: 100, limit: 0.5 }).ok).toBe(true);
    expect(checkOrphanShare({ orphanCount: 30, totalObjects: 100, limit: 0.1 }).ok).toBe(false);
  });

  it("treats an empty bucket as nothing to do", () => {
    expect(checkOrphanShare({ orphanCount: 0, totalObjects: 0 }).ok).toBe(true);
  });

  it("fails closed on counts it cannot make sense of", () => {
    expect(checkOrphanShare({ orphanCount: NaN, totalObjects: 100 }).ok).toBe(false);
    expect(checkOrphanShare({ orphanCount: -1, totalObjects: 100 }).ok).toBe(false);
    expect(checkOrphanShare({ orphanCount: 5, totalObjects: undefined as unknown as number }).ok).toBe(false);
  });
});
