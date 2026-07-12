import { describe, it, expect } from "vitest";
import { normalizeBloomColor, CANONICAL_COLORS } from "../src/lib/photo-facets";

describe("normalizeBloomColor", () => {
  it("maps exact canonical names", () => {
    expect(normalizeBloomColor("pink")).toBe("pink");
    expect(normalizeBloomColor("Purple")).toBe("purple");
  });
  it("maps variants via keywords", () => {
    expect(normalizeBloomColor("light pink")).toBe("pink");
    expect(normalizeBloomColor("deep reddish-purple")).toBe("purple");
    expect(normalizeBloomColor("pale yellow / cream")).toBe("yellow");
    expect(normalizeBloomColor("lavender")).toBe("purple");
  });
  it("returns null for empty / none / unmappable noise", () => {
    expect(normalizeBloomColor("")).toBeNull();
    expect(normalizeBloomColor("none")).toBeNull();
    expect(normalizeBloomColor("n/a")).toBeNull();
    expect(normalizeBloomColor("variegated foliage")).toBeNull();
  });
  it("exposes a swatch hex for every canonical color", () => {
    for (const c of CANONICAL_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
