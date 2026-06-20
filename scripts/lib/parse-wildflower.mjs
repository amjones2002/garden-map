import { parse } from "node-html-parser";

/**
 * Parse one WildflowersOrg ecoregion HTML export into
 * {scientific_name, common_name, ecoregion} rows.
 *
 * Table layout: row 1 = ecoregion description (single cell),
 * row 2 = header (Scientific Name | Common Name | Duration | Habit | Sun | Water),
 * rows 3+ = data.
 *
 * @param {string} html
 * @param {string} ecoregion
 * @returns {Array<{scientific_name: string, common_name: string, ecoregion: string}>}
 */
export function parseWildflower(html, ecoregion) {
  const root = parse(html);
  const rows = root.querySelectorAll("tr");
  const out = [];
  for (const tr of rows) {
    const cells = tr
      .querySelectorAll("td, th")
      .map((c) => c.text.replace(/\s+/g, " ").trim());
    if (cells.length < 6) continue; // skip the description row
    if (cells[0].toLowerCase() === "scientific name") continue; // skip header
    const scientific_name = cells[0];
    const common_name = cells[1];
    if (!scientific_name) continue;
    out.push({ scientific_name, common_name, ecoregion });
  }
  return out;
}
