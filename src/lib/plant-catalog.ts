export type CatalogResult = {
  id: string;
  scientific_name: string;
  common_name: string | null;
  other_common_names: string | null;
};

/** Strip whitespace and characters that break Supabase's `.or()` filter builder. */
export function sanitizeQuery(q: string): string {
  return q.trim().replace(/[%,()]/g, "");
}

const sortName = (r: CatalogResult): string =>
  (r.common_name ?? r.scientific_name).toLowerCase();

/**
 * Rank catalog matches: names that *start with* the query come first,
 * then substring-only matches. Each tier is alphabetical by display name.
 */
export function rankCatalogResults(rows: CatalogResult[], q: string): CatalogResult[] {
  const needle = q.trim().toLowerCase();
  const isPrefix = (r: CatalogResult): boolean =>
    (r.common_name ?? "").toLowerCase().startsWith(needle) ||
    r.scientific_name.toLowerCase().startsWith(needle);

  return [...rows].sort((a, b) => {
    const ap = isPrefix(a);
    const bp = isPrefix(b);
    if (ap !== bp) return ap ? -1 : 1;
    return sortName(a).localeCompare(sortName(b));
  });
}
