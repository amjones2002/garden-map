import { describe, it, expect } from "vitest";
import { parseGps } from "../src/lib/exif";

describe("parseGps", () => {
  it("returns lat/lng with accuracy when present", () => {
    expect(parseGps({ latitude: 32.9, longitude: -96.7 }, 4.5))
      .toEqual({ lat: 32.9, lng: -96.7, accuracy: 4.5 });
  });
  it("returns accuracy null when the error field is missing/non-numeric", () => {
    expect(parseGps({ latitude: 32.9, longitude: -96.7 }))
      .toEqual({ lat: 32.9, lng: -96.7, accuracy: null });
    expect(parseGps({ latitude: 32.9, longitude: -96.7 }, "n/a"))
      .toEqual({ lat: 32.9, lng: -96.7, accuracy: null });
  });
  it("returns null when coordinates are absent or non-finite", () => {
    expect(parseGps(null)).toBeNull();
    expect(parseGps({})).toBeNull();
    expect(parseGps({ latitude: NaN, longitude: -96.7 })).toBeNull();
  });
});
