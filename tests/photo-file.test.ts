import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  parseFilenameDate,
  extractCaptureDate,
  downscale,
  sourceRefFor,
} from "../scripts/lib/photo-file.mjs";

describe("parseFilenameDate", () => {
  it("reads an 8-digit date embedded in the filename", () => {
    const d = parseFilenameDate("IMG_20240615_101500.jpg");
    expect(d?.getUTCFullYear()).toBe(2024);
    expect(d?.getUTCMonth()).toBe(5); // June (0-indexed)
    expect(d?.getUTCDate()).toBe(15);
  });
  it("returns null when there is no plausible date", () => {
    expect(parseFilenameDate("photo.jpg")).toBeNull();
    expect(parseFilenameDate("IMG_99999999.jpg")).toBeNull(); // invalid month/day
  });
});

describe("downscale", () => {
  it("caps the long edge and shrinks the byte size", async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 140, b: 70 } },
    }).jpeg().toBuffer();
    const small = await downscale(big, { maxEdge: 1280, quality: 75 });
    const meta = await sharp(small).metadata();
    expect(meta.width).toBe(1280);
    expect(small.length).toBeLessThanOrEqual(big.length);
  });
});

describe("extractCaptureDate", () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "photo-file-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("uses the filename date when EXIF is absent", async () => {
    const p = join(dir, "IMG_20230704_080000.jpg");
    const buf = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
    await writeFile(p, buf);
    const { date, source } = await extractCaptureDate(p, buf);
    expect(source).toBe("filename");
    expect(date.getUTCFullYear()).toBe(2023);
  });

  it("falls back to mtime when nothing else is available", async () => {
    const p = join(dir, "no-date.jpg");
    const buf = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).jpeg().toBuffer();
    await writeFile(p, buf);
    const when = new Date("2022-01-02T03:04:05Z");
    await utimes(p, when, when);
    const { source } = await extractCaptureDate(p, buf);
    expect(source).toBe("mtime");
  });
});

describe("sourceRefFor", () => {
  it("returns a POSIX relative path", () => {
    expect(sourceRefFor("/root/dir", "/root/dir/sub/img.jpg")).toBe("sub/img.jpg");
  });
});
