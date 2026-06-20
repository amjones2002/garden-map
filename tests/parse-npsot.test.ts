import { describe, it, expect } from "vitest";
import { parseNpsot } from "../scripts/lib/parse-npsot.mjs";

const SAMPLE = `"Scientific Name","Common Name","Plant URL","Other Common Names","Other Scientific Names","Growth Form","Ecoregion III","Ecoregion IV","Min Height","Max Height","Min Spread","Max Spread","Leaf Retention","Lifespan","Soil","Light","Water","Native Habitat","Bloom Season","Bloom Color","Seasonal Interest","Wildlife Benefit","Maintenence","Comments","References"
"Abronia ameliae","Heart's Delight","https://www.npsot.org/posts/native-plant/abronia-ameliae/","Amelia's Sand-verbena","","Herbaceous","Gulf Coast Prairies and Marshes","Coastal Sand Plain","1","1.5","0.5","1","Deciduous","Perennial","Sand","Sun, Part Shade","Low, Medium","Grassland","Spring","Pink, Purple","Nectar","Butterflies","A note.","A
multi-line comment with an embedded newline.","ref1"`;

describe("parseNpsot", () => {
  it("parses one data row with the right fields", () => {
    const rows = parseNpsot(SAMPLE);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.scientific_name).toBe("Abronia ameliae");
    expect(r.common_name).toBe("Heart's Delight");
    expect(r.source).toBe("npsot.org");
    expect(r.source_url).toBe("https://www.npsot.org/posts/native-plant/abronia-ameliae/");
    expect(r.is_tx_native).toBe(true);
    expect(r.light).toBe("Sun, Part Shade");
    expect(r.water).toBe("Low, Medium");
    expect(r.height_min).toBe(1);
    expect(r.height_max).toBe(1.5);
    expect(r.ecoregions).toEqual([]);
  });

  it("handles embedded newlines inside quoted fields without splitting rows", () => {
    const rows = parseNpsot(SAMPLE);
    expect(rows).toHaveLength(1); // not 2 — the newline is inside a quoted field
  });

  it("coerces blank numerics to null", () => {
    const blank = SAMPLE.replace('"1","1.5","0.5","1"', '"","","",""');
    const rows = parseNpsot(blank);
    expect(rows[0].height_min).toBeNull();
    expect(rows[0].height_max).toBeNull();
  });
});
