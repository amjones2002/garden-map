import { readFileSync } from "fs";
import { resolve } from "path";

export type UsdaResult = {
  /** Synthetic id so callers can use the same shape as CatalogResult */
  id: string;
  scientific_name: string;
  common_name: string | null;
  /** Family name — not part of CatalogResult but useful for display */
  family: string | null;
  /** Signals to the UI that this came from the USDA fallback, not the local catalog */
  source: "usda";
};

type IndexEntry = { s: string; c: string; f: string };

let _index: IndexEntry[] | null = null;

function getIndex(): IndexEntry[] {
  if (_index) return _index;
  const file = resolve(process.cwd(), "src/data/usda-index.json");
  _index = JSON.parse(readFileSync(file, "utf8")) as IndexEntry[];
  return _index;
}

/**
 * Search the USDA PLANTS index for entries whose scientific name or common name
 * contains `q` (case-insensitive). Returns up to `limit` results, prefix matches first.
 */
export function searchUsdaPlants(q: string, limit = 10): UsdaResult[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];

  const index = getIndex();
  const prefixMatches: UsdaResult[] = [];
  const substringMatches: UsdaResult[] = [];

  for (const entry of index) {
    const sci = entry.s.toLowerCase();
    const common = entry.c.toLowerCase();
    const isMatch = sci.includes(needle) || common.includes(needle);
    if (!isMatch) continue;

    const result: UsdaResult = {
      id: `usda:${entry.s}`,
      scientific_name: entry.s,
      common_name: entry.c || null,
      family: entry.f || null,
      source: "usda",
    };

    if (sci.startsWith(needle) || common.startsWith(needle)) {
      prefixMatches.push(result);
    } else {
      substringMatches.push(result);
    }

    if (prefixMatches.length + substringMatches.length >= limit * 3) break;
  }

  const sort = (a: UsdaResult, b: UsdaResult) =>
    (a.common_name ?? a.scientific_name).localeCompare(b.common_name ?? b.scientific_name);

  return [...prefixMatches.sort(sort), ...substringMatches.sort(sort)].slice(0, limit);
}
