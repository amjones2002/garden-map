# Plan 3 — Map View & Zone Panel

**Goal:** Replace the placeholder zone list with an illustrated, tappable SVG map (stylized from the survey) where tapping a zone opens a slide-up detail panel showing description, current plants (gated add/delete), and recent purchases. Add the zone-photos storage bucket + gated upload + chronological gallery.

**Architecture:** A `BaseMap` SVG (viewBox 0 0 1000 1000) draws lot hardscape; `ZoneShapes` renders `<polygon>`s from `zones.shape` (normalized ×1000). `MapView` (client) tracks the selected zone and renders `ZonePanel`. Plants/purchases/photos read via anon; writes go through gated routes (`/api/plants`, `/api/zone-photos`) reusing the Plan 2 `requireEdit` guard. Photos live in a public `zone-photos` Supabase Storage bucket.

## Global constraints
- Zone coords are normalized 0–1; multiply by 1000 for the SVG.
- Mobile-first; panel slides up from the bottom; 44px touch targets.
- Writes gated by edit cookie (Plan 2). Reads public.
- Triangle / The Field intentionally absent (await user placement).

## Files
- `src/lib/geometry.ts` — `centroid(points)`, `toSvgPoints(points, size)` (pure, tested)
- `src/components/BaseMap.tsx` — stylized lot/house/pool/porch hardscape SVG
- `src/components/ZoneShapes.tsx` — polygons + labels from zones
- `src/components/MapView.tsx` — client; fetch zones, selection state, render panel
- `src/components/ZonePanel.tsx` — slide-up: description, plants, purchases, photos, add-purchase link
- `src/app/page.tsx` — render `MapView`
- `src/app/api/plants/route.ts` — POST (gated) add plant; DELETE (gated) remove
- `src/app/api/zone-photos/route.ts` — POST (gated) record a photo row; DELETE (gated)
- `scripts/setup-storage.mjs` — create public `zone-photos` bucket (service-role)
- Tests: `tests/geometry.test.ts`

## Tasks
1. **geometry (TDD)** — centroid + toSvgPoints. Commit.
2. **BaseMap + ZoneShapes** — stylized hardscape + zone polygons/labels. Commit.
3. **MapView + selection** — fetch zones, tap to select, highlight. Commit.
4. **ZonePanel reads** — description, plants list, recent purchases (anon reads). Commit.
5. **Gated plant CRUD** — `/api/plants` POST/DELETE + panel add/remove (edit mode). Commit.
6. **Photos** — `setup-storage.mjs` bucket; `/api/zone-photos`; gallery + gated upload. Commit.
7. **Verify + merge** — tests, build, live preview (tap zone → panel; add plant when unlocked). Merge to main.

Photos (Task 6) is the lowest priority; if time-constrained overnight, defer it to a follow-up and ship Tasks 1–5 + 7.
