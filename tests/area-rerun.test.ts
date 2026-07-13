import { describe, it, expect } from "vitest";
import { planAreaRerun } from "../scripts/lib/area-rerun-core.mjs";

describe("planAreaRerun", () => {
  it("returns null when GPS gives no area", () => {
    expect(planAreaRerun({ area: "front" }, null)).toBeNull();
  });
  it("returns null when the stored area already agrees", () => {
    expect(planAreaRerun({ area: "south" }, "south")).toBeNull();
  });
  it("fills a null stored area silently (no re-open)", () => {
    expect(planAreaRerun({ area: null }, "front")).toEqual({ area: "front" });
  });
  it("re-opens a disagreeing row to pending", () => {
    expect(planAreaRerun({ area: "front" }, "south")).toEqual({ area: "south", review_status: "pending" });
  });
});
