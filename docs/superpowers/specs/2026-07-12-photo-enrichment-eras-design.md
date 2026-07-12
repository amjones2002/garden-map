# Photo Enrichment & "Through the Eras" — Design

**Date:** 2026-07-12
**Status:** Approved (design); implementation plan pending
**Depends on:** Phase 1 — [photo-classification-pipeline-design](2026-07-11-photo-classification-pipeline-design.md)
and Phase 2 — [photo-timeline-phase2-design](2026-07-11-photo-timeline-phase2-design.md)
(both merged to `main`).

## Goal

Phases 1–2 classified ~2,900 photos into `zone_photos`, each carrying a rich
`ai_meta` payload (caption, tags, plants, bloom colors, hardscape milestone flags,
quality, reasoning), and built the review-queue + live-upload UIs. **None of that
enrichment is visible to a viewer**, and the "narrate the evolution" layer that
Phase 1 explicitly deferred was never built.

This project delivers the two deferred pieces as one cohesive feature:

1. **Surface the `ai_meta` enrichment** in the photo UI — a shared display panel
   (caption, plants, bloom colors, tags, quality, AI summary) that appears wherever
   a photo opens, plus a **filterable public gallery** over the whole collection.
2. **"Through the eras" narrative** — a public **timeline page** telling the yard's
   evolution as milestone-driven chapters with nested seasons, each with a short
   AI-written headline/blurb.

All three surfaces read only `review_status = 'confirmed'` rows (existing RLS and
explicit filters), reuse the Phase 1 `ai_meta` shape, and **require no schema
migration**.

## Locked decisions (from brainstorming)

- **Narrative generation = hybrid.** Era boundaries and per-era/season stats are
  computed deterministically from the data; a short **headline + blurb per era** is
  AI-written once and stored. Eras themselves are never AI-guessed.
- **Era storage = committed data file.** A `scripts/generate-eras.mjs` script
  computes boundaries from live data, calls Claude once per era for the headline/
  blurb, and writes a versioned `src/lib/eras.data.ts`. No migration, no new table;
  regenerate = rerun the script + commit.
- **Gallery filtering = compact projection, client-side.** A server component loads
  a lightweight projection of all confirmed photos (~1,900 rows, ~400 KB) and a
  client component facets/searches instantly; thumbnails lazy-load via `<Image>`.
- **Era model = milestones + nested seasons.** Top-level chapters are milestone
  eras; each chapter groups its photos into Season+Year sub-sections.
- **Three surfaces, phased build** (dependency order): shared enrichment display →
  ZonePanel lightbox → gallery → timeline.
- **Timeline nav = sticky era rail** (desktop left rail / mobile sticky chip row).
- **Gallery nav = grouped filter chips on top** (labeled groups; mobile collapses
  to a "Filters" button + grouped bottom-sheet).

## Context: what already exists

- **Data** — 2,912 `zone_photos` rows (1,893 confirmed), `taken_at` spanning
  2024-10-17 → present. Of confirmed rows: ~1,876 have captions/tags/hardscape,
  ~1,819 have plants, ~1,074 have bloom colors.
- **`ai_meta` shape** — already typed in [`src/lib/types.ts`](../../../src/lib/types.ts)
  (`AiMeta`, with `quality`, `reasoning`, `tags[]`, `plants[]`,
  `hardscape: Record<string,boolean>`, `botanical.bloom_colors[]`). No type changes
  needed.
- **Hardscape milestones + first-appearance dates** (the raw material for eras):
  `raised_beds`, `stock_tank`, `cedar_planters` first appear **2025-04-13**;
  `vines` **2025-04-15**; `cover_crop_field` **2025-05-18**. Everything before
  mid-April 2025 is the "established yard."
- **Supabase clients** — [`getServerSupabase`](../../../src/lib/supabase/server.ts)
  (service-role, server-only, bypasses RLS) and
  [`getBrowserSupabase`](../../../src/lib/supabase/client.ts) (anon, RLS-limited to
  confirmed).
- **Photo helpers** — [`publicPhotoUrl`, `sortChronological`](../../../src/lib/photos.ts);
  [`AREA_ORDER`, `AREA_LABELS`, `areaForZone`](../../../src/lib/zones.ts).
- **Lightbox today** — [`ZonePanel`](../../../src/components/ZonePanel.tsx) has an
  inline lightbox showing only the image (no enrichment).
- **Nav** — [`Nav.tsx`](../../../src/components/Nav.tsx): Map / Tracker / (Photos,
  edit-only). Test suite under `tests/`, standalone scripts under `scripts/`.

### Key constraint discovered: the raw tag/plant vocabulary is huge and noisy

Confirmed rows contain **2,125 distinct tag strings, 3,698 distinct plant strings**
(free-text: *"possibly salvia"*, *"ornamental grasses or perennials along fence
bed"*), and 101 bloom-color variants. **Raw `tags`/`plants` cannot be filter
facets** — thousands of one-offs. They render as per-photo display chips only.
Filtering runs on the **clean, low-cardinality** dimensions; free-text search covers
the messy ones.

## Non-goals

- No schema migration, no new table, no GIN index (client-side filtering).
- No re-classification and no changes to the Phase 1/2 classifier or import.
- No changes to the public map read path or the review-queue/upload UIs.
- No per-photo AI calls at request time — the only AI is the one-time era
  generation (a handful of calls total).
- No plant→`plant_catalog` linking (Phase 1 preserved `ai_meta.plants` for this, but
  it stays out of scope here).

## Architecture

Everything is **read + render** over existing data. Public pages (gallery, timeline)
are server components that read confirmed rows via `getServerSupabase()` with an
explicit `.eq("review_status","confirmed")` filter (matching how `/photos` loads),
then hand data to client components. Per **AGENTS.md**, the Next.js in this repo has
breaking changes — read `node_modules/next/dist/docs/` before writing any page /
server-component / route code.

### Shared foundations (built first)

**1. `src/lib/photo-facets.ts`** — pure, unit-tested:
- `normalizeBloomColor(raw: string): CanonicalColor | null` — maps the 101 raw
  variants to ~12 canonical colors (pink, red, purple, blue, white, yellow, orange,
  green, coral, magenta, cream, other) via a keyword table; returns `null` for
  un-mappable noise.
- `CANONICAL_COLORS` with display swatch hex values.
- `seasonYear(dateISO): { season: "winter"|"spring"|"summer"|"fall"; year: number }`.
- `photoMilestones(photo): MilestoneKey[]` — the hardscape flags that are `true`.
- `PhotoFacets` type + `deriveFacets(photo, zones, eras)` → the compact projection
  record `{ id, storage_path, taken_at, area, zoneSlug, zoneName, milestones[],
  bloomColors[], quality, eraKey, season, year }`.
- `matchesFilters(facet, filters): boolean` and `search(facet, text)` (the latter
  reads a per-photo lowercased haystack of caption + tags + plants).
- `availableFacets(facets): FacetCounts` — distinct values + counts per dimension,
  for rendering only the chips that exist.

**2. `src/lib/eras.ts`** — pure, unit-tested (the deterministic era engine):
- `MILESTONES` — ordered metadata for the 5 hardscape keys: `{ key, label, icon }`.
- `detectMilestoneArrivals(photos): Record<MilestoneKey, string | null>` — robust
  first-appearance date per milestone, **guarded against single-photo false
  positives** (a milestone counts as "arrived" only once it appears in ≥2 photos, or
  recurs within a short window; exact guard tuned during implementation and
  unit-tested with a planted outlier).
- `buildEras(arrivals, photos): Era[]` — chronological chapters bounded by arrivals,
  **bundling milestones whose arrivals fall in the same window** (e.g. the three
  2025-04-13 milestones form one "Build-Out" chapter). Produces a leading
  "before the build" era from the earliest photo to the first arrival. Each `Era`:
  `{ key, milestones: MilestoneKey[], start: string, end: string | null }`.
- `assignEra(dateISO, eras): string` — bucket a photo into an era key by date.
- `groupBySeason(photos): SeasonGroup[]` — Season+Year sub-groups, chronological.

`eras.ts` holds the deterministic logic used by **both** the generate script and the
timeline page; `eras.data.ts` (below) caches boundaries + AI text.

**3. `src/lib/eras.data.ts`** — the committed generation output (see pipeline
below). A typed `EraContent[]`:
```ts
export type EraContent = {
  key: string;
  title: string;        // AI headline, e.g. "The Build-Out"
  blurb: string;        // AI 1–2 sentence summary
  milestones: MilestoneKey[];
  start: string;        // ISO
  end: string | null;   // ISO, null = ongoing
  coverPath: string | null; // representative photo storage_path
  generatedAt: string;
  model: string;
};
export const ERAS: EraContent[] = [ /* written by generate-eras.mjs */ ];
```
The file ships first as a committed **empty stub** (`ERAS = []`) so Phases A–B
compile before Phase C generates content. With `ERAS` empty, `deriveFacets` yields
no `eraKey`, so the gallery's **Era** facet simply doesn't render until the script
has run — a graceful, ordering-safe default.

**4. `src/components/PhotoMeta.tsx`** — the one reusable enrichment panel. Given a
`ZonePhoto` (+ resolved zone name + era title), renders, in order:
caption → facts line (date · zone · era · `quality` badge) → **Blooming** (normalized
bloom-color swatches) → **Plants spotted** (green chips from `ai_meta.plants`) →
**In frame** (muted chips from `ai_meta.tags`) → a collapsible **"AI Summary"**
disclosure (`ai_meta.reasoning`, closed by default). Sections with no data are
omitted. Pure presentational; no data fetching.

**5. `src/components/PhotoLightbox.tsx`** — extracted from `ZonePanel`'s inline
lightbox into a shared component (full-screen image + `PhotoMeta`), so the map
panel, gallery, and timeline open the identical viewer. Desktop = image + side
panel; mobile = image with meta scrolling below.

### Phase A — ZonePanel lightbox enrichment

Extract the lightbox from [`ZonePanel`](../../../src/components/ZonePanel.tsx) into
`PhotoLightbox` and render `PhotoMeta` inside it. `ZonePanel` already loads full
`zone_photos` rows, so `ai_meta` is present — no query change. Smallest slice,
immediate value, no new page or AI. (Resolves the Phase 2 open item "extract a
shared lightbox component.")

### Phase B — Filterable gallery (`/gallery`)

- **`src/app/gallery/page.tsx`** — public server component. Reads all confirmed
  `zone_photos` + `zones` + imports `ERAS`; maps each row through `deriveFacets` into
  the compact projection; passes the projection array to a client component. (Full
  `ai_meta` is **not** shipped in the projection — the lightbox refetches the one
  opened row, or the projection carries a small display subset; decided in the plan.)
- **`src/app/gallery/GalleryBrowser.tsx`** (client) — grouped filter chips on top
  (Area / Zone / Era / Season-Year / Milestone / Bloom / Quality, rendered from
  `availableFacets`) + a free-text search box; a responsive photo grid below;
  live result count + "clear". Filtering is `matchesFilters` + `search` in-memory —
  instant. Mobile: filters collapse behind a "Filters · N" button that opens a
  grouped bottom-sheet; grid stays full-width. Tapping a photo opens `PhotoLightbox`.
- Nav gains a **"Gallery"** link (public, always shown).

### Phase C — Timeline / eras (`/timeline`)

- **`src/app/timeline/page.tsx`** — public server component. Imports `ERAS`, reads
  confirmed photos, buckets each into its era (`assignEra`) and then into seasons
  (`groupBySeason`), and renders the **sticky era rail** layout: a left rail listing
  era titles (desktop) / a sticky chip row (mobile) that jumps to a chapter; the
  content pane shows, per era, the AI title + date range + milestone badges + blurb,
  then season sub-sections each with a representative photo strip. Photos open in
  `PhotoLightbox`.
- Nav gains a **"Timeline"** link (public).

### The generation pipeline — `scripts/generate-eras.mjs`

Standalone Node script (matches `scripts/import-photos.mjs`), run manually:

1. Load all confirmed `zone_photos` (service-role) via the same env the other
   scripts use.
2. `detectMilestoneArrivals` + `buildEras` (imported from `eras.ts`) → deterministic
   boundaries.
3. For each era: assemble a compact digest of that era's photos (sample of captions,
   aggregated top tags/plants, bloom colors, milestone(s), date range, photo count)
   and make **one** Claude call (`@anthropic-ai/sdk` directly, `ANTHROPIC_API_KEY`,
   structured output) returning `{ title, blurb }`. Pick a `coverPath` (highest-
   confidence "good"-quality photo in the era).
4. Write `src/lib/eras.data.ts` (formatted, with `generatedAt` + `model`).
5. `--dry-run` prints the computed eras + prompts **without** calling Claude or
   writing the file, so boundaries can be sanity-checked first.

Total cost is a handful of calls (one per era, ~4–6), one-time.

## Error handling

- **Gallery** — a bad/empty projection renders an empty grid with a message, never
  crashes. `deriveFacets` tolerates missing `ai_meta` sub-keys (all optional). Photos
  with un-mappable bloom colors simply don't get a bloom facet.
- **PhotoMeta** — every section guards on presence; a row with `ai_meta = {}` shows
  just the caption/facts. No section renders empty.
- **Timeline** — if `ERAS` is empty (script never run), the page shows a graceful
  "timeline not generated yet" state instead of erroring. Photos that fall outside
  all era bounds (shouldn't happen) bucket into the last/ongoing era defensively.
- **generate-eras.mjs** — a failed Claude call for one era logs and falls back to a
  deterministic title/blurb (e.g. "Raised beds & stock tank · Apr 2025") so the file
  still writes; re-running regenerates. Missing `ANTHROPIC_API_KEY` → clear exit.

## Testing

Follows the existing `tests/` + TDD pattern.

- **`photo-facets.ts`** — `normalizeBloomColor` (canonical mapping + null on noise),
  `seasonYear` (boundary months, year rollover), `photoMilestones`, `matchesFilters`
  (each dimension + combinations), `search` (caption/tag/plant hits), `deriveFacets`
  (tolerates sparse `ai_meta`), `availableFacets` counts.
- **`eras.ts`** — `detectMilestoneArrivals` (correct dates + **outlier guard**:
  a single stray flag doesn't move the arrival), `buildEras` (same-window bundling,
  leading pre-build era, ongoing final era), `assignEra` boundaries, `groupBySeason`.
- **`PhotoMeta` / `PhotoLightbox`** — render tests: sections appear only when data
  present; "AI Summary" collapsed by default; empty `ai_meta` shows caption only.
- **`GalleryBrowser`** — filter interaction narrows the rendered set; "clear"
  resets; result count matches.
- **Manual/preview** — dev server: open a map-zone photo and confirm enrichment
  shows; filter the gallery by area+bloom and confirm counts; run
  `generate-eras.mjs --dry-run` and eyeball the era boundaries; view `/timeline`.

## New / changed files

**New**
- `src/lib/photo-facets.ts` — normalization, season, facet derivation, filter/search.
- `src/lib/eras.ts` — milestone detection, era building, season grouping.
- `src/lib/eras.data.ts` — committed generation output (`ERAS`).
- `src/components/PhotoMeta.tsx` — shared enrichment panel.
- `src/components/PhotoLightbox.tsx` — shared full-screen viewer.
- `src/app/gallery/page.tsx` + `src/app/gallery/GalleryBrowser.tsx`.
- `src/app/timeline/page.tsx` (+ any client child for the sticky-rail interaction).
- `scripts/generate-eras.mjs` — era boundary + AI headline generator (`--dry-run`).
- Tests as above.

**Changed**
- `src/components/ZonePanel.tsx` — use the extracted `PhotoLightbox` + `PhotoMeta`.
- `src/components/Nav.tsx` — add public "Gallery" and "Timeline" links.

**Unchanged (explicitly):** `src/lib/types.ts` (`AiMeta` already sufficient),
schema/migrations, the classifier, import, review, and upload paths.

## Phasing

Ship in dependency order; each phase is independently valuable and mergeable:

1. **Foundations + Phase A** — `PhotoMeta`, `PhotoLightbox`, ZonePanel enrichment,
   and the slice of `photo-facets.ts` that `PhotoMeta` needs (`normalizeBloomColor`,
   `seasonYear`). PhotoMeta's era line is optional and stays blank until Phase C.
   Commit the empty `eras.data.ts` stub here so everything downstream compiles.
2. **Phase B** — the rest of `photo-facets.ts` (filtering/facets), `/gallery` +
   Nav link. Works with the empty `ERAS` stub; the Era facet lights up after Phase C.
3. **Phase C** — `eras.ts`, `generate-eras.mjs`, regenerated `eras.data.ts`,
   `/timeline` + Nav link.

## Open items for the implementation plan

- Whether the gallery projection carries a small display subset of `ai_meta`, or the
  lightbox refetches the single opened row on demand (payload size vs. extra query).
- The exact milestone-arrival outlier guard (≥2 occurrences vs. recurs-within-window)
  — tune against the real data in the plan.
- `normalizeBloomColor` keyword table — enumerate against the 101 real variants.
- Whether the timeline's per-era photo strips cap at N with a "see all in gallery"
  link (deep-link the gallery to an era filter) to keep the page light.
- Sticky-rail mechanics (scroll-spy active state) and the mobile chip-row behavior.
- Structured-output schema for the era `{title, blurb}` Claude call.

## Deploy notes

- **`generate-eras.mjs` uses the Anthropic SDK directly** (`@anthropic-ai/sdk`),
  consistent with the Phase 1/2 decision — not the Vercel AI Gateway.
- **`ANTHROPIC_API_KEY`** is already a server-side env var (used by
  `import-photos.mjs`); the generate script reuses it. It is **not** needed at
  request time — the deployed app never calls Claude for this feature; it only reads
  the committed `eras.data.ts`.
- No new env vars, buckets, or Vercel config. Gallery/timeline are public routes;
  no edit gate.
