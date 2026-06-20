# Plan 5 — Zone Shape Editor

**Goal:** A gated `/editor` view where you pick a zone and reshape its polygon over the map — tap to add points, drag to move, remove points — then save. Touch-friendly. Shapes persist to `zones.shape` and immediately drive the live map.

**Architecture:** A client `ShapeEditor` draws the stylized `BaseMap` (same coordinate space as the live map) plus an editable polygon in SVG user units (0–1000). Pointer events (mouse + touch) handle add/drag/remove; pointer→SVG mapping via `getScreenCTM().inverse()`. A pure `normalizeShape` (tested) converts SVG points to clamped, rounded 0–1 before saving via gated `PATCH /api/zones`. An optional faint survey overlay aids tracing. The page is gated behind edit mode.

## Global constraints
- Coordinates stored normalized 0–1 (×1000 in the editor). Round to 4 dp, clamp [0,1].
- Editor is gated (edit cookie). Locked users see a prompt.
- Saving a shape updates the same `zones.shape` the live map reads.

## Files
- `src/lib/geometry.ts` — add `normalizeShape(points, size)` (pure, tested)
- `src/app/api/zones/route.ts` — `PATCH` (gated): update `{ id, shape }`
- `src/components/ShapeEditor.tsx` — the editor (zone select, draw/drag/remove, save, survey toggle)
- `src/app/editor/page.tsx` — gated wrapper rendering `ShapeEditor`
- `src/components/Nav.tsx` — add an "Editor" link when unlocked
- `public/survey-page-1.png` — copy of the rendered survey for the reference overlay
- Tests: extend `tests/geometry.test.ts`

## Tasks
1. **normalizeShape (TDD)** — scale↓, round, clamp. Commit.
2. **PATCH /api/zones** — gated shape update. Commit.
3. **ShapeEditor** — base map + editable polygon, pointer add/drag, remove point, save, survey toggle. Commit.
4. **/editor page + Nav link** — gated; locked prompt. Commit.
5. **Verify + merge** — tests, build, live (unlock → edit a zone → save → live map reflects it). Merge to main.
