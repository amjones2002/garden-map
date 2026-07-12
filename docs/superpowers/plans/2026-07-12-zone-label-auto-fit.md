# Zone Label Auto-Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make yard-map zone labels automatically fit inside their own shape — anchored at a smart interior point, wrapped to two lines when needed, and shrunk to fit — so labels stop overlapping.

**Architecture:** Two pure functions added to `src/lib/geometry.ts` (`visualCenter` for a
"pole of inaccessibility" anchor, `fitLabel` for wrap-then-shrink text sizing), consumed by
`src/components/ZoneShapes.tsx` which renders the label as one or more `<tspan>` lines. No
schema, API, or editor changes. Free-floating map labels are untouched.

**Tech Stack:** TypeScript, React (Next.js), SVG, Vitest + @testing-library/react (jsdom).

## Global Constraints

- All geometry helpers operate on normalized `Point` coords (`{ x: number; y: number }`, each 0..1) — consistent with existing `src/lib/geometry.ts`.
- `ZoneShapes` scales normalized coords by `const SIZE = 1000` before rendering.
- Label tuning constants live in code, not config: `LABEL_CAP = 34`, `LABEL_FLOOR = 13`, `LABEL_FILL = 0.9`, `CHAR_W = 0.5`, `LINE_HEIGHT = 1.15`.
- Tests live in `tests/*.test.{ts,tsx}` and run via `npm test` (`vitest run`). Path alias `@` → `./src`; existing tests import from `../src/...`.
- Follow existing code style: 2-space indent, double quotes, named exports.

---

### Task 1: `visualCenter` anchor helper

**Files:**
- Modify: `src/lib/geometry.ts` (add `visualCenter` + private helpers)
- Test: `tests/geometry.test.ts` (add cases)

**Interfaces:**
- Consumes: existing `centroid(points: Point[]): Point`, `type Point` from `src/lib/geometry.ts`.
- Produces: `export function visualCenter(points: Point[]): Point` — returns an interior point (the point furthest from any edge). Falls back to `centroid(points)` for `< 3` points or degenerate (zero-area) polygons.

- [ ] **Step 1: Write the failing tests**

Add to `tests/geometry.test.ts` (inside the existing `describe("geometry", ...)` block), and add `visualCenter` to the import on line 2:

```ts
it("visualCenter of a unit square is near its center", () => {
  const c = visualCenter([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  expect(c.x).toBeCloseTo(0.5, 1);
  expect(c.y).toBeCloseTo(0.5, 1);
});

it("visualCenter of an L-shaped polygon lands inside the shape", () => {
  // L-shape: full bottom strip + left column. The corner-average (centroid)
  // falls in the empty notch (top-right); visualCenter must be inside the ink.
  const L: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 0.4 },
    { x: 0.4, y: 0.4 },
    { x: 0.4, y: 1 },
    { x: 0, y: 1 },
  ];
  const c = visualCenter(L);
  // Point-in-polygon check via ray casting.
  let inside = false;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
    const intersect =
      (L[i].y > c.y) !== (L[j].y > c.y) &&
      c.x < ((L[j].x - L[i].x) * (c.y - L[i].y)) / (L[j].y - L[i].y) + L[i].x;
    if (intersect) inside = !inside;
  }
  expect(inside).toBe(true);
});

it("visualCenter falls back to centroid for < 3 points", () => {
  expect(visualCenter([{ x: 0.2, y: 0.3 }])).toEqual({ x: 0.2, y: 0.3 });
  expect(visualCenter([])).toEqual({ x: 0, y: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/geometry.test.ts`
Expected: FAIL — `visualCenter is not a function` (or import error).

- [ ] **Step 3: Implement `visualCenter` and helpers**

Append to `src/lib/geometry.ts`:

```ts
function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function distanceToEdges(p: Point, poly: Point[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    min = Math.min(min, distToSegment(p, poly[j], poly[i]));
  }
  return min;
}

/**
 * "Pole of inaccessibility": the interior point furthest from any edge — a
 * robust label anchor that stays inside concave (e.g. L-shaped) polygons.
 * Falls back to `centroid` for degenerate input.
 */
export function visualCenter(points: Point[]): Point {
  if (points.length < 3) return centroid(points);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX - minX === 0 || maxY - minY === 0) return centroid(points);

  let best = centroid(points);
  let bestDist = pointInPolygon(best, points) ? distanceToEdges(best, points) : -1;

  const GRID = 8;
  let cx = minX, cy = minY, cw = maxX - minX, ch = maxY - minY;
  for (let iter = 0; iter < 6; iter++) {
    const stepX = cw / GRID, stepY = ch / GRID;
    for (let i = 0; i <= GRID; i++) {
      for (let j = 0; j <= GRID; j++) {
        const p = { x: cx + i * stepX, y: cy + j * stepY };
        if (!pointInPolygon(p, points)) continue;
        const d = distanceToEdges(p, points);
        if (d > bestDist) { bestDist = d; best = p; }
      }
    }
    // Zoom the search window into the neighbourhood of the current best.
    cw = (cw / GRID) * 2;
    ch = (ch / GRID) * 2;
    cx = best.x - cw / 2;
    cy = best.y - ch / 2;
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/geometry.test.ts`
Expected: PASS (all geometry tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geometry.ts tests/geometry.test.ts
git commit -m "feat: visualCenter label anchor for concave zones"
```

---

### Task 2: `fitLabel` wrap-then-shrink helper

**Files:**
- Modify: `src/lib/geometry.ts` (add `fitLabel` + constants + private `balancedSplit`)
- Test: `tests/geometry.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export function fitLabel(text: string, boxWidth: number, boxHeight: number): { lines: string[]; fontSize: number }`. `boxWidth`/`boxHeight` are in SVG units (already scaled by SIZE). `lines` has length 1 or 2 and is never empty; `fontSize` is an integer in `[LABEL_FLOOR, LABEL_CAP]`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/geometry.test.ts` (inside the `describe` block) and add `fitLabel` to the import on line 2:

```ts
it("fitLabel keeps a short name on one line at the cap size in a wide box", () => {
  const r = fitLabel("North Side", 300, 60);
  expect(r.lines).toEqual(["North Side"]);
  expect(r.fontSize).toBe(34);
});

it("fitLabel wraps a long multi-word name to two balanced lines in a narrow box", () => {
  const r = fitLabel("Front Street Beds", 120, 220);
  expect(r.lines.length).toBe(2);
  expect(r.lines.join(" ")).toBe("Front Street Beds");
  // Two lines let the font stay larger than cramming onto one line would.
  expect(r.fontSize).toBeGreaterThan(fitLabel("Front Street Beds", 120, 20).fontSize);
});

it("fitLabel shrinks a single long word (cannot wrap) to fit width", () => {
  const r = fitLabel("Driveway", 60, 200);
  expect(r.lines).toEqual(["Driveway"]);
  expect(r.fontSize).toBeLessThan(34);
  expect(r.fontSize).toBeGreaterThanOrEqual(13);
});

it("fitLabel never goes below the floor and never returns empty lines", () => {
  const r = fitLabel("Field Bed + Vines", 30, 20);
  expect(r.fontSize).toBe(13);
  expect(r.lines.length).toBeGreaterThan(0);
  expect(r.lines.every((l) => l.length > 0)).toBe(true);
});

it("fitLabel handles blank text", () => {
  const r = fitLabel("   ", 100, 100);
  expect(r.lines.length).toBe(1);
  expect(r.fontSize).toBe(13);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/geometry.test.ts`
Expected: FAIL — `fitLabel is not a function`.

- [ ] **Step 3: Implement `fitLabel`, constants, and `balancedSplit`**

Append to `src/lib/geometry.ts`:

```ts
const LABEL_CAP = 34;      // max font size (SVG units)
const LABEL_FLOOR = 13;    // min legible font size
const LABEL_FILL = 0.9;    // fraction of the box the text may occupy
const CHAR_W = 0.5;        // avg glyph width as a fraction of font size (hand font)
const LINE_HEIGHT = 1.15;  // line advance as a multiple of font size

/** Split words into two lines with the most even character counts. */
function balancedSplit(words: string[]): [string, string] {
  let bestIdx = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    const diff = Math.abs(left.length - right.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return [words.slice(0, bestIdx).join(" "), words.slice(bestIdx).join(" ")];
}

/**
 * Fit `text` inside a `boxWidth` x `boxHeight` box (SVG units): try one line,
 * then two balanced lines, and pick whichever allows the largest font.
 * Font is capped at LABEL_CAP and floored at LABEL_FLOOR; lines are never empty.
 */
export function fitLabel(
  text: string,
  boxWidth: number,
  boxHeight: number,
): { lines: string[]; fontSize: number } {
  const clean = text.trim();
  if (!clean) return { lines: [""].map(() => " "), fontSize: LABEL_FLOOR };

  const words = clean.split(/\s+/);
  const candidates: string[][] = [[clean]];
  if (words.length > 1) candidates.push(balancedSplit(words));

  let best: { lines: string[]; fontSize: number } | null = null;
  for (const lines of candidates) {
    const longest = Math.max(...lines.map((l) => l.length));
    const fByWidth = (boxWidth * LABEL_FILL) / (longest * CHAR_W);
    const fByHeight = (boxHeight * LABEL_FILL) / (lines.length * LINE_HEIGHT);
    const fontSize = Math.min(LABEL_CAP, fByWidth, fByHeight);
    if (!best || fontSize > best.fontSize) best = { lines, fontSize };
  }

  const chosen = best!;
  return {
    lines: chosen.lines,
    fontSize: Math.max(LABEL_FLOOR, Math.round(chosen.fontSize)),
  };
}
```

Note: the blank-text branch returns a single space so downstream `<tspan>` rendering stays valid while showing nothing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/geometry.test.ts`
Expected: PASS (all geometry tests, including the 5 new `fitLabel` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geometry.ts tests/geometry.test.ts
git commit -m "feat: fitLabel wrap-then-shrink text sizing"
```

---

### Task 3: Render auto-fit labels in `ZoneShapes`

**Files:**
- Modify: `src/components/ZoneShapes.tsx`
- Test: `tests/zone-shapes.test.tsx` (create)

**Interfaces:**
- Consumes: `visualCenter` (Task 1), `fitLabel` (Task 2), existing `toSvgPoints` — all from `@/lib/geometry`.
- Produces: rendered zone labels as `<text>` with one `<tspan>` per line at the fitted font size. No exported API change; `ZoneShapes` props are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/zone-shapes.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ZoneShapes from "../src/components/ZoneShapes";
import type { Zone } from "../src/lib/types";

function zone(overrides: Partial<Zone>): Zone {
  return {
    id: "z1",
    slug: "z1",
    name: "Zone",
    label: null,
    description: null,
    shape: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    fill_color: null,
    sort_order: 0,
    created_at: "",
    area: null,
    ...overrides,
  };
}

describe("ZoneShapes labels", () => {
  it("wraps a long name in a narrow tall zone onto two tspans", () => {
    const z = zone({
      name: "Front Street Beds",
      shape: [
        { x: 0.0, y: 0.0 },
        { x: 0.12, y: 0.0 },
        { x: 0.12, y: 0.9 },
        { x: 0.0, y: 0.9 },
      ],
    });
    const { container } = render(
      <svg>
        <ZoneShapes zones={[z]} selectedId={null} onSelect={() => {}} />
      </svg>,
    );
    const tspans = container.querySelectorAll("text tspan");
    expect(tspans.length).toBe(2);
    expect(Array.from(tspans).map((t) => t.textContent).join(" ")).toBe(
      "Front Street Beds",
    );
  });

  it("shrinks the font below the 34 cap for a small zone", () => {
    const z = zone({
      name: "Driveway",
      shape: [
        { x: 0.0, y: 0.0 },
        { x: 0.06, y: 0.0 },
        { x: 0.06, y: 0.05 },
        { x: 0.0, y: 0.05 },
      ],
    });
    const { container } = render(
      <svg>
        <ZoneShapes zones={[z]} selectedId={null} onSelect={() => {}} />
      </svg>,
    );
    const text = container.querySelector("text");
    expect(Number(text?.getAttribute("font-size"))).toBeLessThan(34);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/zone-shapes.test.tsx`
Expected: FAIL — currently the label renders as a single hard-coded `fontSize={34}` text node with no `<tspan>` children.

- [ ] **Step 3: Update `ZoneShapes` to auto-fit and render tspans**

In `src/components/ZoneShapes.tsx`:

Change the import on line 1 from:

```tsx
import { centroid, toSvgPoints } from "@/lib/geometry";
```

to:

```tsx
import { visualCenter, fitLabel, toSvgPoints } from "@/lib/geometry";
```

Replace the body of the `zones.map` callback (lines 17–53, from `const pts = ...` through the closing `</g>` return) with:

```tsx
        const pts = Array.isArray(z.shape) ? z.shape : [];
        if (pts.length < 3) return null;
        const selected = z.id === selectedId;
        const c = visualCenter(pts);
        const cx = c.x * SIZE;
        const cy = c.y * SIZE;

        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const boxWidth = (Math.max(...xs) - Math.min(...xs)) * SIZE;
        const boxHeight = (Math.max(...ys) - Math.min(...ys)) * SIZE;
        const { lines, fontSize } = fitLabel(z.label ?? z.name, boxWidth, boxHeight);
        const linePx = fontSize * 1.15;
        const startY = cy - ((lines.length - 1) / 2) * linePx;

        return (
          <g
            key={z.id}
            role="button"
            tabIndex={0}
            aria-label={z.name}
            style={{ cursor: "pointer" }}
            onClick={() => onSelect(z)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(z);
            }}
          >
            <polygon
              points={toSvgPoints(pts, SIZE)}
              fill={z.fill_color ?? "#7aa329"}
              fillOpacity={selected ? 0.85 : 0.6}
              stroke={selected ? "#3f4a2e" : "#5e6b3a"}
              strokeWidth={selected ? 7 : 3}
            />
            <text
              x={cx}
              y={startY}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#2f3722"
              style={{ pointerEvents: "none", fontFamily: "var(--font-hand), cursive" }}
            >
              {lines.map((line, i) => (
                <tspan key={i} x={cx} y={startY + i * linePx}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
```

(`const SIZE = 1000` on line 4 is unchanged and still used.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/zone-shapes.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full test suite and lint**

Run: `npm test`
Expected: PASS (no regressions).
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Browser verification**

Start the dev server and load the map. Confirm the previously crowded areas now read cleanly:
- Front Yard label sits inside the yard block, no longer over House Beds.
- The Dry Mineral Bed / Field Bed + Vines / The Field cluster no longer runs together.
- Long names (Front Street Beds, Field Bed + Vines) wrap to two lines; small zones have smaller text.

Take a screenshot for the record.

- [ ] **Step 7: Commit**

```bash
git add src/components/ZoneShapes.tsx tests/zone-shapes.test.tsx
git commit -m "feat: auto-fit zone labels (smart anchor + wrap/shrink)"
```

---

## Self-Review

**Spec coverage:**
- Smarter anchor (`visualCenter`, pole of inaccessibility, inside concave shapes) → Task 1. ✓
- Wrap-then-shrink with floor, never hidden (`fitLabel`) → Task 2. ✓
- Render change in `ZoneShapes` (swap anchor, bounding box, tspans, keep click behavior) → Task 3. ✓
- Unit tests for `visualCenter` and `fitLabel` → Tasks 1 & 2. ✓
- Browser verification of the named crowded spots → Task 3 Step 6. ✓
- Non-goals honored: no schema/API/editor changes, no manual override, no map-label changes. ✓

**Placeholder scan:** No TBD/TODO; all code is complete and concrete.

**Type consistency:** `visualCenter(points: Point[]): Point`, `fitLabel(text, boxWidth, boxHeight): { lines: string[]; fontSize: number }` used identically in Task 3. `Point` and `SIZE` match existing code. Constants match the Global Constraints block.
