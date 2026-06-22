# Rotatable map labels (replaces hardcoded street labels)

_Date: 2026-06-22 · Backlog item #3 (genericize on-map street labels for privacy)_

## Problem

`BaseMap.tsx` hard-codes three street `<text>` labels — `Eastview Cir`, `Baltimore Drive`,
`alley` — which name the real location and defeat the earlier privacy scrub. Separately, the
owner wants to annotate sub-areas *within* a zone (e.g. the "raised bed" zone actually holds
8 smaller beds) without promoting each into a full zone.

Both needs are the same need: free-placed, customizable text on the map. The existing
DB-backed free-text label system (`map_labels` → `MapLabels` + `LabelEditor` at
`/editor/labels`) already supports free placement, text, color, drag, and delete — it already
covers the sub-bed case today. The only capability it lacks for the street labels is
**rotation** (the slanted street names), plus a surfaced **font-size** control so sub-bed
labels can be made small.

## Approach

Do not special-case streets. Extend the one label system with rotation, expose font-size in
the editor, then convert the three hardcoded street labels into ordinary `map_labels` rows
seeded with **generic** text. After this, streets are data, not code, and the same mechanism
serves both the privacy goal and the in-zone annotation goal.

Rejected alternatives:
- **Toggle (real ↔ generic):** hardcodes the "generic" strings, gives no customization, and
  does nothing for the sub-bed case. Dead end.
- **Separate "editable streets" widget:** duplicates a system that already exists.

## Changes

### 1. Migration (`supabase/migrations/`)
- Add column: `rotation real NOT NULL DEFAULT 0` (degrees) to `map_labels`.
- Seed three rows at the current street positions/rotations/sizes, with generic text and
  center-anchor-adjusted coordinates (`MapLabels` renders `textAnchor="middle"`; two of the
  hardcoded labels used the default start-anchor, so their x must shift to the visual center):

  | text     | was               | rotation | font_size | color     | notes |
  |----------|-------------------|----------|-----------|-----------|-------|
  | `Street` | Eastview Cir      | −82°     | 32        | `#7a6a44` | recompute x/y for middle-anchor |
  | `Drive`  | Baltimore Drive   | 0°       | 32        | `#7a6a44` | recompute x for middle-anchor |
  | `alley`  | alley (unchanged) | 90°      | 22        | `#9c8567` | recompute x/y for middle-anchor |

  Original hardcoded values for reference (from `BaseMap.tsx:97-106`):
  - Eastview Cir: `x=60 y=520 rotate(-82 60 520) fontSize=32 fill=#7a6a44` (start-anchor)
  - Baltimore Drive: `x=430 y=958 fontSize=32 fill=#7a6a44` (start-anchor, no rotation)
  - alley: `x=940 y=500 rotate(90 940 500) fontSize=22 fill=#9c8567` (start-anchor)

  Rotation pivot stays the anchor point, so recomputing the anchor to the text's visual
  center keeps each label in the same place on screen. Verify final placement against the
  live map during implementation (rasterize the SVG and compare).

### 2. Types & render
- `src/lib/types.ts`: add `rotation: number` to `MapLabel`.
- `src/components/MapLabels.tsx`: when `rotation` is non-zero, apply
  `transform={`rotate(${l.rotation} ${x} ${y})`}` (x,y already in ×1000 SVG space).
- `src/components/BaseMap.tsx`: delete the three hardcoded street `<text>` elements
  (lines 97-106 and the `{/* Street labels */}` comment). Leave the street/alley *shapes*.

### 3. API (`src/app/api/map-labels/route.ts`)
- Add `rotation?: number` to `LabelBody`.
- POST: insert `rotation` (default `0` when absent).
- PATCH: `if (typeof body.rotation === "number") update.rotation = body.rotation;`
- No clamp needed beyond it being a finite number (rotation is unbounded degrees); follow the
  existing validation style.

### 4. Editor (`src/components/LabelEditor.tsx`)
- For the selected label, add two controls beside the existing text/color inputs:
  - **rotation** — number input in degrees, bound to a new `editRotation` state.
  - **font-size** — number input, bound to a new `editFontSize` state (API already supports
    `font_size`; it's just not currently surfaced in the UI).
- `saveSelected()` includes `rotation` and `font_size` in the PATCH body.
- When a label is selected (`onLabelDown`), initialize the new state from the label.
- Editor preview render applies the same `rotate(...)` transform so the owner sees rotation
  while editing.

## Privacy note

`map_labels` is a public-read table on a shared DB, so seeded text is what the public sees.
Defaults are intentionally generic (`Street`, `Drive`, `alley`). The owner *can* rename them
to real names via the editor, but doing so re-exposes the location publicly — that is the
owner's explicit choice, not the default.

## Out of scope (YAGNI)

- No drag-to-rotate handle; a degrees input is enough.
- No binding labels to a parent zone; free-floating placement covers the 8-beds case.

## Done when

- `rotation` column exists; three street labels render from the DB with generic text at the
  same on-screen positions/angles as before.
- `BaseMap.tsx` no longer contains any real street names.
- Editor can set text, color, position (existing), rotation, and font-size on any label;
  changes persist and re-render.
- The raised-bed zone can be annotated with multiple small labels via `/editor/labels`.
- `npm test`, `npm run build` green; live check confirms label placement.
