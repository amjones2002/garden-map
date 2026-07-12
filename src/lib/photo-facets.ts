export type CanonicalColor =
  | "pink" | "red" | "purple" | "blue" | "white" | "yellow"
  | "orange" | "green" | "coral" | "magenta" | "cream";

export const CANONICAL_COLORS: { key: CanonicalColor; label: string; hex: string }[] = [
  { key: "pink", label: "Pink", hex: "#e58bb0" },
  { key: "red", label: "Red", hex: "#c0392b" },
  { key: "purple", label: "Purple", hex: "#7b5aa6" },
  { key: "blue", label: "Blue", hex: "#4a72b0" },
  { key: "white", label: "White", hex: "#f2efe6" },
  { key: "yellow", label: "Yellow", hex: "#e5c84a" },
  { key: "orange", label: "Orange", hex: "#e08a3c" },
  { key: "green", label: "Green", hex: "#6f8150" },
  { key: "coral", label: "Coral", hex: "#e5795b" },
  { key: "magenta", label: "Magenta", hex: "#c1447e" },
  { key: "cream", label: "Cream", hex: "#eadfc0" },
];

// Keyword → canonical. First match wins; order matters (specific before generic).
const KEYWORDS: [string, CanonicalColor][] = [
  ["lavender", "purple"], ["violet", "purple"], ["lilac", "purple"], ["mauve", "purple"], ["purple", "purple"],
  ["magenta", "magenta"], ["fuchsia", "magenta"],
  ["coral", "coral"], ["salmon", "coral"], ["peach", "coral"],
  ["pink", "pink"], ["rose", "pink"],
  ["red", "red"], ["crimson", "red"], ["scarlet", "red"], ["burgundy", "red"],
  ["orange", "orange"], ["apricot", "orange"],
  ["yellow", "yellow"], ["gold", "yellow"],
  ["cream", "cream"], ["ivory", "cream"], ["off-white", "cream"],
  ["blue", "blue"], ["indigo", "blue"],
  ["white", "white"],
  ["green", "green"], ["chartreuse", "green"],
];

const NULLISH = new Set(["", "none", "n/a", "na", "unknown", "no blooms", "foliage"]);

export function normalizeBloomColor(raw: string): CanonicalColor | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || NULLISH.has(s)) return null;
  for (const [kw, canon] of KEYWORDS) if (s.includes(kw)) return canon;
  return null;
}

// --- appended below Task 1 exports ---
import type { Area, Zone, ZonePhoto } from "./types";
import type { EraContent, MilestoneKey } from "./eras.data";
import { MILESTONE_KEYS, assignEra, seasonYear } from "./eras.mjs";

export type { MilestoneKey };

export type PhotoFacet = {
  id: string; storagePath: string; takenAt: string | null;
  zoneId: string | null; zoneName: string | null; area: Area | null;
  quality: "good" | "ok" | "poor" | null;
  caption: string | null; reasoning: string | null;
  bloomColors: CanonicalColor[]; milestones: MilestoneKey[];
  eraKey: string | null; season: string; year: number;
  searchText: string;
};

export type Filters = {
  areas: Area[]; zoneIds: string[]; eraKeys: string[]; seasonYears: string[];
  milestones: MilestoneKey[]; bloom: CanonicalColor[]; quality: string[]; text: string;
};

export const EMPTY_FILTERS: Filters = {
  areas: [], zoneIds: [], eraKeys: [], seasonYears: [], milestones: [], bloom: [], quality: [], text: "",
};

export function deriveFacet(photo: ZonePhoto, zones: Zone[], eras: EraContent[]): PhotoFacet {
  const zone = zones.find((z) => z.id === photo.zone_id) ?? null;
  const meta = photo.ai_meta ?? {};
  const hardscape = (meta.hardscape ?? {}) as Record<string, boolean>;
  const milestones = MILESTONE_KEYS.filter((k) => hardscape[k] === true) as MilestoneKey[];
  const bloomColors = Array.from(
    new Set((meta.botanical?.bloom_colors ?? []).map(normalizeBloomColor).filter((c): c is CanonicalColor => c !== null)),
  );
  const date = photo.taken_at ?? photo.uploaded_at;
  const { season, year } = seasonYear(date);
  const searchText = [photo.caption, ...(meta.tags ?? []), ...(meta.plants ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  return {
    id: photo.id, storagePath: photo.storage_path, takenAt: photo.taken_at,
    zoneId: photo.zone_id, zoneName: zone?.name ?? null, area: zone?.area ?? photo.area ?? null,
    quality: (meta.quality as PhotoFacet["quality"]) ?? null,
    caption: photo.caption, reasoning: (meta.reasoning as string) ?? null,
    bloomColors, milestones,
    eraKey: assignEra(date, eras), season, year, searchText,
  };
}

const seasonYearKey = (f: PhotoFacet) => `${f.season}-${f.year}`;

export function matchesFilters(f: PhotoFacet, x: Filters): boolean {
  if (x.areas.length && (!f.area || !x.areas.includes(f.area))) return false;
  if (x.zoneIds.length && (!f.zoneId || !x.zoneIds.includes(f.zoneId))) return false;
  if (x.eraKeys.length && (!f.eraKey || !x.eraKeys.includes(f.eraKey))) return false;
  if (x.seasonYears.length && !x.seasonYears.includes(seasonYearKey(f))) return false;
  if (x.milestones.length && !x.milestones.some((m) => f.milestones.includes(m))) return false;
  if (x.bloom.length && !x.bloom.some((b) => f.bloomColors.includes(b))) return false;
  if (x.quality.length && (!f.quality || !x.quality.includes(f.quality))) return false;
  if (x.text.trim() && !f.searchText.includes(x.text.trim().toLowerCase())) return false;
  return true;
}

function tally<T extends string>(rows: PhotoFacet[], pick: (f: PhotoFacet) => T[] | T | null) {
  const counts = new Map<T, number>();
  for (const f of rows) {
    const v = pick(f);
    const vals = Array.isArray(v) ? v : v == null ? [] : [v];
    for (const x of vals) counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return counts;
}

export function availableFacets(facets: PhotoFacet[]) {
  const seasonLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace("-", " ");
  const zoneName = (id: string) => facets.find((f) => f.zoneId === id)?.zoneName ?? id;
  const toRows = <T extends string>(m: Map<T, number>, label?: (v: T) => string) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) =>
      label ? { value, label: label(value), count } : { value, count });
  return {
    areas: toRows(tally(facets, (f) => f.area)) as { value: Area; count: number }[],
    zones: toRows(tally(facets, (f) => f.zoneId), zoneName) as { value: string; label: string; count: number }[],
    eras: toRows(tally(facets, (f) => f.eraKey)) as { value: string; count: number }[],
    seasonYears: toRows(tally(facets, seasonYearKey), seasonLabel) as { value: string; label: string; count: number }[],
    milestones: toRows(tally(facets, (f) => f.milestones)) as { value: MilestoneKey; count: number }[],
    bloom: toRows(tally(facets, (f) => f.bloomColors)) as { value: CanonicalColor; count: number }[],
    quality: toRows(tally(facets, (f) => f.quality)) as { value: string; count: number }[],
  };
}
