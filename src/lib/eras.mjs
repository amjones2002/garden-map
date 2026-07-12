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

// --- appended below Task 5 exports ---
const dayMs = 86400000;
const takenOf = (p) => p.taken_at ?? p.uploaded_at;
const flagsOf = (p) => (p.ai_meta && p.ai_meta.hardscape) || {};

/** First date d where >= minCount occurrences fall within [d, d+windowDays]. */
function firstSustained(dates, windowDays, minCount) {
  const sorted = [...dates].sort();
  for (let i = 0; i < sorted.length; i++) {
    const start = new Date(sorted[i]).getTime();
    const count = sorted.filter((d) => {
      const t = new Date(d).getTime();
      return t >= start && t <= start + windowDays * dayMs;
    }).length;
    if (count >= minCount) return sorted[i];
  }
  return null;
}

export function detectMilestoneArrivals(photos, opts = {}) {
  const { windowDays = 45, minCount = 2 } = opts;
  const out = {};
  for (const key of MILESTONE_KEYS) {
    const dates = photos.filter((p) => flagsOf(p)[key] === true).map(takenOf);
    out[key] = firstSustained(dates, windowDays, minCount);
  }
  return out;
}

export function buildEras(photos, opts = {}) {
  const { bundleDays = 20 } = opts;
  const arrivals = detectMilestoneArrivals(photos, opts);
  const points = MILESTONE_KEYS
    .filter((k) => arrivals[k])
    .map((k) => ({ key: k, date: arrivals[k] }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Bundle arrivals within bundleDays into one boundary.
  const boundaries = [];
  for (const p of points) {
    const last = boundaries[boundaries.length - 1];
    if (last && new Date(p.date).getTime() - new Date(last.date).getTime() <= bundleDays * dayMs) {
      last.milestones.push(p.key);
    } else {
      boundaries.push({ date: p.date, milestones: [p.key] });
    }
  }

  const earliest = photos.map(takenOf).sort()[0] ?? new Date().toISOString();
  const eras = [{ key: "era-0", milestones: [], start: earliest, end: boundaries[0]?.date ?? null }];
  boundaries.forEach((b, i) => {
    eras.push({ key: `era-${i + 1}`, milestones: b.milestones, start: b.date, end: boundaries[i + 1]?.date ?? null });
  });
  return eras;
}

export function defaultEraTitle(era) {
  if (!era.milestones || era.milestones.length === 0) return "Before the build";
  const labels = era.milestones.map((k) => MILESTONES.find((m) => m.key === k)?.label ?? k);
  return labels.join(" & ");
}

export function groupBySeason(photos) {
  const map = new Map();
  for (const p of photos) {
    const { season, year } = seasonYear(takenOf(p));
    const key = `${season}-${year}`;
    if (!map.has(key)) map.set(key, { key, season, year, photos: [] });
    map.get(key).photos.push(p);
  }
  return [...map.values()].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : ["winter", "spring", "summer", "fall"].indexOf(a.season) - ["winter", "spring", "summer", "fall"].indexOf(b.season),
  );
}
