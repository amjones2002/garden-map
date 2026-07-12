# Zone Label Auto-Fit — Design

**Date:** 2026-07-12
**Status:** Approved (design)

## Problem

Zone labels on the yard map overlap and pile up in crowded areas — "Front Yard" lands on
top of "House Beds", and the "Dry Mineral Bed" / "Field Bed + Vines" / "The Field" cluster
runs together. Two root causes:

1. **Fixed font size.** Every zone label renders at `fontSize={34}` regardless of how small
   the zone is, so narrow zones can't contain their own name.
2. **Poor anchor.** The label is placed at `centroid(points)`, which is just the *average of
   the polygon's corners* ([geometry.ts:4](../../../src/lib/geometry.ts)). For concave /
   L-shaped zones (e.g. Front Yard wrapping around the house) this point can fall in a bad
   spot or effectively over a neighbor.

The free-floating **map labels** (Street, Drive, house, alley) are unaffected — they already
have full manual position/size/rotation control and are out of scope.

## Goals

- Zone labels automatically fit legibly inside their own shape. No manual placement, no
  editor changes, no schema changes.
- Long names wrap to two lines before shrinking; font shrinks only as far as needed, down to
  a legible floor. No label is ever hidden.
- Most existing zones improve out of the box; the change is computed at render time from the
  shape already stored.

## Non-Goals

- No manual per-zone label position/size override (considered and deferred).
- No automatic collision-avoidance between separate labels (unpredictable on a hand-drawn
  map).
- No leader lines / callouts.
- No changes to free-floating map labels.

## Approach

Two automatic levers, both implemented as **pure functions** in
[`geometry.ts`](../../../src/lib/geometry.ts), consumed by
[`ZoneShapes.tsx`](../../../src/components/ZoneShapes.tsx).

### 1. `visualCenter(points: Point[]): Point`

A compact "pole of inaccessibility" — the interior point furthest from any edge, i.e. the
center of the largest open area of the polygon. Properties:

- Always lands **inside** the polygon, including concave / L-shaped zones. This is what fixes
  the Front Yard → House Beds collision (the label moves into the large open block rather
  than the notch).
- For simple convex shapes the result is ≈ the current center, so most labels barely move.
- Implementation: grid/quadtree refinement over the polygon bounding box (standard polylabel
  approach), using a point-in-polygon + distance-to-edges test. ~40 lines, no dependencies.
- Operates in normalized (0..1) coordinates, consistent with the rest of `geometry.ts`.

### 2. `fitLabel(text, boxWidth, boxHeight): { lines: string[]; fontSize: number }`

Given the zone's bounding-box width and height (in SVG units), returns the lines to render
and the font size to use.

Algorithm:

1. Start at the default cap font size (**34**).
2. Estimate rendered width of the text as `charCount * fontSize * K`, where `K` is a tuned
   constant for the hand font (≈ 0.5, calibrated during implementation). No DOM measurement —
   deterministic and free of async font-load timing.
3. If a single line exceeds ~**90%** of `boxWidth`, split the words into two **balanced**
   lines (minimize the longer line's character count). Single-word names cannot wrap.
4. Choose the largest font size ≤ 34 where **the widest line fits ~90% of `boxWidth`** *and*
   **the stacked line(s) fit ~90% of `boxHeight`** (two lines ≈ `2 * fontSize * lineHeight`).
5. If it still doesn't fit, clamp to a floor of ~**13px** and stop. The label always renders.

Constants (`CAP = 34`, `FLOOR = 13`, `FILL = 0.9`, `K ≈ 0.5`, `LINE_HEIGHT ≈ 1.1`) live in
code; not user-configurable (YAGNI).

### 3. Rendering change — `ZoneShapes.tsx`

- Replace `const c = centroid(pts)` with `const c = visualCenter(pts)`.
- Compute the polygon bounding box (min/max of points × SIZE) → `boxWidth`, `boxHeight`.
- Call `fitLabel(z.label ?? z.name, boxWidth, boxHeight)`.
- Render the `<text>` anchored at `c` with the computed `fontSize`, emitting one `<tspan>` per
  line (vertically centered around the anchor). Replaces today's single hard-coded
  `fontSize={34}` text node.
- Zone selection / click / keyboard behavior is unchanged.

## Testing

- **Unit tests** (vitest, already configured):
  - `visualCenter`: returns a point inside a concave / L-shaped polygon; ≈ center for a
    square; handles < 3 points gracefully.
  - `fitLabel`: wraps a long multi-word name to two balanced lines; shrinks font for a narrow
    box; respects the floor and never returns empty `lines`; keeps a short name on one line at
    the cap size; single-word long name shrinks without wrapping.
- **Browser verification**: load the real map and confirm the known crowded spots — Front
  Yard / House Beds, and the Dry Mineral Bed / Field Bed + Vines / The Field cluster — now
  read cleanly.

## Risks & Mitigations

- **Width estimate inaccuracy.** The character-count estimate is approximate for a
  proportional hand font. Mitigation: tune `K` conservatively (slightly over-estimate width)
  so labels err toward fitting; the `FILL = 0.9` margin absorbs the rest. Acceptable because
  the goal is "no collisions," not pixel-perfect fit.
- **`visualCenter` cost.** Runs per zone (~16) on load; grid refinement is cheap at this
  count. No perf concern.
- **Residual zone-vs-map-label overlap** (e.g. Front Street Beds near the "Street"
  annotation). The smaller font + inward anchor reduces it; fully resolving it would require
  moving the manual map label, which is out of scope.
