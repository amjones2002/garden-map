import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildClassificationSchema,
  parseClassification,
  MODEL,
} from "../src/lib/zone-classifier.mjs";

const ZONES = [
  { slug: "stock-tank", name: "Stock Tank Fountain", area: "front", description: "Stock tank fountain." },
  { slug: "pool-spa", name: "Pool & Spa", area: "pool", description: "Pool and spa." },
  { slug: "front-raised-bed", name: "Front Raised Bed", area: "south", description: "8x3 raised bed." },
];

describe("buildSystemPrompt", () => {
  const p = buildSystemPrompt(ZONES);
  it("lists every zone slug", () => {
    for (const z of ZONES) expect(p).toContain(z.slug);
  });
  it("groups zones under their area headings", () => {
    expect(p.toLowerCase()).toContain("front");
    expect(p.toLowerCase()).toContain("pool");
    expect(p.toLowerCase()).toContain("south");
  });
  it("names the Red Oak divider and the permanent anchors", () => {
    expect(p).toContain("Red Oak");
    expect(p.toLowerCase()).toContain("fence");
    expect(p.toLowerCase()).toContain("pool");
  });
  it("tells the model to ignore transient foreground", () => {
    expect(p.toLowerCase()).toContain("ignore");
    expect(p.toLowerCase()).toContain("plant");
  });
});

describe("buildClassificationSchema", () => {
  const schema = buildClassificationSchema(ZONES.map((z) => z.slug));
  it("constrains zone_slug to the known slugs plus null", () => {
    const zs = schema.properties.zone_slug;
    const flat = JSON.stringify(zs);
    expect(flat).toContain("stock-tank");
    expect(flat).toContain("null");
  });
  it("keeps plants as its own array property", () => {
    expect(schema.properties.plants.type).toBe("array");
  });
  it("forbids extra properties", () => {
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("parseClassification", () => {
  it("parses a full valid payload", () => {
    const r = parseClassification(JSON.stringify({
      is_yard: true, quality: "good", area: "front", zone_slug: "stock-tank",
      confidence: 0.9, reasoning: "brick + oak", caption: "Stock tank in summer",
      tags: ["summer"], plants: ["milkweed", "coneflower"],
      hardscape: { stock_tank: true, raised_beds: false, vines: false, cover_crop_field: false, cedar_planters: false },
      botanical: { bloom_colors: ["orange"], notes: "monarch habitat" },
    }));
    expect(r.zone_slug).toBe("stock-tank");
    expect(r.plants).toEqual(["milkweed", "coneflower"]);
    expect(r.hardscape.stock_tank).toBe(true);
  });
  it("fills defaults for missing arrays/objects", () => {
    const r = parseClassification(JSON.stringify({
      is_yard: false, quality: "poor", area: null, zone_slug: null, confidence: 0.1,
    }));
    expect(r.plants).toEqual([]);
    expect(r.tags).toEqual([]);
    expect(r.hardscape).toEqual({});
    expect(r.botanical).toEqual({});
  });
});

describe("MODEL", () => {
  it("is Sonnet 4.6", () => expect(MODEL).toBe("claude-sonnet-4-6"));
});
