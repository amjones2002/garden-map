/**
 * Attach WildflowersOrg ecoregion membership to NPSOT catalog rows by
 * case-insensitive scientific-name match. NPSOT is the catalog spine —
 * wildflower-only species are NOT added.
 *
 * @param {Array<object>} npsotRows  rows from parseNpsot
 * @param {Array<{scientific_name: string, ecoregion: string}>} wildflowerRows
 * @returns {Array<object>} npsot rows with populated `ecoregions` (deduped, sorted)
 */
export function mergeCatalog(npsotRows, wildflowerRows) {
  const byName = new Map();
  for (const w of wildflowerRows) {
    const key = w.scientific_name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(w.ecoregion);
  }
  return npsotRows.map((r) => {
    const key = r.scientific_name.toLowerCase().trim();
    const regions = byName.get(key);
    return {
      ...r,
      ecoregions: regions ? [...regions].sort() : [],
    };
  });
}
