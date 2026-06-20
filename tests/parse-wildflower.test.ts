import { describe, it, expect } from "vitest";
import { parseWildflower } from "../scripts/lib/parse-wildflower.mjs";

const HTML = `
<table>
  <tr><td>Cross Timbers description spanning one cell.</td></tr>
  <tr><td>Scientific Name</td><td>Common Name</td><td>Duration</td><td>Habit</td><td>Sun</td><td>Water</td></tr>
  <tr><td>Abutilon fruticosum</td><td>Texas Indian Mallow</td><td>Perennial</td><td>Herb</td><td>Sun</td><td>Dry</td></tr>
  <tr><td>Acacia angustissima</td><td>Prairie Acacia</td><td>Perennial</td><td>Shrub</td><td>Sun</td><td>Dry</td></tr>
</table>`;

describe("parseWildflower", () => {
  it("extracts data rows tagged with the ecoregion", () => {
    const rows = parseWildflower(HTML, "Cross Timbers");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      scientific_name: "Abutilon fruticosum",
      common_name: "Texas Indian Mallow",
      ecoregion: "Cross Timbers",
    });
  });

  it("skips the description row and the header row", () => {
    const rows = parseWildflower(HTML, "Cross Timbers");
    const names = rows.map((r) => r.scientific_name);
    expect(names).not.toContain("Scientific Name");
  });
});
