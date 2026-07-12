// Deterministic era engine. Shared by the app (runtime helpers), tests, and
// scripts/generate-eras.mjs (Phase C adds detection/build here). Plain ESM so a
// node script can import it — mirrors src/lib/zone-classifier.mjs.

export const MILESTONE_KEYS = ["stock_tank", "raised_beds", "cedar_planters", "vines", "cover_crop_field"];

export const MILESTONES = [
  { key: "stock_tank", label: "Stock tank", icon: "🛢" },
  { key: "raised_beds", label: "Raised beds", icon: "🛏" },
  { key: "cedar_planters", label: "Cedar planters", icon: "🌲" },
  { key: "vines", label: "Vines", icon: "🌿" },
  { key: "cover_crop_field", label: "Cover-crop field", icon: "🌾" },
];

/** Northern-hemisphere season + calendar year. */
export function seasonYear(dateISO) {
  const d = new Date(dateISO);
  const m = d.getUTCMonth(); // 0-11
  const season = m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "fall";
  return { season, year: d.getUTCFullYear() };
}

/** Era key whose [start, end) contains the date; last era's null end = ongoing. */
export function assignEra(dateISO, eras) {
  if (!eras || eras.length === 0) return null;
  for (const e of eras) {
    if (dateISO >= e.start && (e.end === null || dateISO < e.end)) return e.key;
  }
  // Before the first era's start → defensively bucket into the first era.
  return dateISO < eras[0].start ? eras[0].key : eras[eras.length - 1].key;
}
