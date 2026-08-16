import { describe, it, expect } from "vitest";
import { fitInside, displayFilename } from "../src/lib/image-downscale";
import { DISPLAY_MAX_EDGE } from "../src/lib/image-spec.mjs";

describe("fitInside", () => {
  it("scales a landscape photo to the long edge", () => {
    expect(fitInside(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it("scales a portrait photo to the long edge", () => {
    expect(fitInside(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
  });

  it("scales a square photo on both edges", () => {
    expect(fitInside(2000, 2000, 1280)).toEqual({ width: 1280, height: 1280 });
  });

  it("never enlarges an image already under the cap", () => {
    expect(fitInside(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });

  it("leaves an exactly-sized image alone", () => {
    expect(fitInside(1280, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it("keeps a very wide panorama at least one pixel tall", () => {
    const { height } = fitInside(20000, 100, 1280);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("defaults to the shared display cap", () => {
    expect(fitInside(4000, 3000)).toEqual(fitInside(4000, 3000, DISPLAY_MAX_EDGE));
  });

  it("returns zeroes for degenerate dimensions", () => {
    expect(fitInside(0, 0, 1280)).toEqual({ width: 0, height: 0 });
  });
});

describe("displayFilename", () => {
  it("swaps a jpg extension for webp", () => {
    expect(displayFilename("IMG_2481.jpg")).toBe("IMG_2481.webp");
  });

  it("handles uppercase and multi-dot names", () => {
    expect(displayFilename("2024.05.11 hellstrip.JPEG")).toBe("2024.05.11 hellstrip.webp");
  });

  it("appends an extension when there is none", () => {
    expect(displayFilename("scan")).toBe("scan.webp");
  });
});
