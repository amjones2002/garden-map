import { parse } from "csv-parse/sync";

const numOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Parse the NPSOT native plant table CSV into catalog row objects.
 * Uses a real CSV parser so quoted fields containing embedded newlines
 * (NPSOT Comments/References) do not split rows.
 *
 * @param {string} csvText
 * @returns {Array<object>}
 */
export function parseNpsot(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  return records
    .map((row) => ({
      scientific_name: (row["Scientific Name"] || "").trim(),
      common_name: (row["Common Name"] || "").trim(),
      other_common_names: strOrNull(row["Other Common Names"]),
      growth_form: strOrNull(row["Growth Form"]),
      height_min: numOrNull(row["Min Height"]),
      height_max: numOrNull(row["Max Height"]),
      spread_min: numOrNull(row["Min Spread"]),
      spread_max: numOrNull(row["Max Spread"]),
      light: strOrNull(row["Light"]),
      water: strOrNull(row["Water"]),
      soil: strOrNull(row["Soil"]),
      bloom_season: strOrNull(row["Bloom Season"]),
      bloom_color: strOrNull(row["Bloom Color"]),
      wildlife_benefit: strOrNull(row["Wildlife Benefit"]),
      native_habitat: strOrNull(row["Native Habitat"]),
      ecoregions: [],
      is_tx_native: true,
      source: "npsot.org",
      source_url: strOrNull(row["Plant URL"]),
    }))
    .filter((r) => r.scientific_name !== "");
}
