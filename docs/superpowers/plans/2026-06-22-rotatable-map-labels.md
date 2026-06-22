# Rotatable Map Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Genericize the hardcoded street names for privacy by converting them into ordinary DB map labels, and add rotation (+ surfaced font-size) so the one label system covers slanted street labels and small in-zone annotations alike.

**Architecture:** Extend the existing `map_labels` table/system (`MapLabels` renderer + `LabelEditor` at `/editor/labels`) with a `rotation` column. Convert the three hardcoded `<text>` street labels in `BaseMap.tsx` into seeded DB rows with generic text. No new components.

**Tech Stack:** Next.js 16 (App Router, TS) · React 19 · Supabase (Postgres + Storage) · Vitest + @testing-library/react · SQL migrations in `supabase/migrations/`.

## Global Constraints

- **Next.js 16**: this is NOT the Next.js in your training data. Read `node_modules/next/dist/docs/` before writing any Next-specific code.
- **Workflow**: every change = branch → PR → merge. Verify before merge: `npm test`, `npm run build`, and a live check.
- **Rotation unit**: degrees (matches SVG `rotate(...)`).
- **Privacy**: `map_labels` is a public-read table; seeded street text MUST be generic — `Street`, `Drive`, `alley`. Never seed the real names.
- **Tests**: vitest, run with `npm test`. Component tests render with `@testing-library/react` and wrap SVG fragments in an `<svg>` element.
- **Coordinates**: normalized 0..1 in the DB; multiplied by `SIZE = 1000` for the SVG viewBox.

---

### Task 1: Add `rotation` to the type and render it in `MapLabels`

**Files:**
- Modify: `src/lib/types.ts:23-33` (`MapLabel` type)
- Modify: `src/components/MapLabels.tsx`
- Test: `tests/map-labels.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MapLabel.rotation: number` (degrees); `MapLabels` renders each `<text>` with `transform="rotate(<rotation> <x*1000> <y*1000>)"` when `rotation` is non-zero, and no `transform` attribute when `rotation` is `0`.

- [ ] **Step 1: Write the failing test**

Create `tests/map-labels.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MapLabels from "../src/components/MapLabels";
import type { MapLabel } from "../src/lib/types";

const base: MapLabel = {
  id: "1",
  text: "Street",
  x: 0.06,
  y: 0.52,
  font_size: 32,
  color: "#7a6a44",
  rotation: -82,
  created_at: "",
  updated_at: "",
  archived_at: null,
};

describe("MapLabels", () => {
  it("applies a rotation transform when rotation is non-zero", () => {
    const { container } = render(
      <svg>
        <MapLabels labels={[base]} />
      </svg>,
    );
    const t = container.querySelector("text");
    expect(t?.getAttribute("transform")).toBe("rotate(-82 60 520)");
  });

  it("omits the transform attribute when rotation is zero", () => {
    const { container } = render(
      <svg>
        <MapLabels labels={[{ ...base, rotation: 0 }]} />
      </svg>,
    );
    const t = container.querySelector("text");
    expect(t?.getAttribute("transform")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- map-labels`
Expected: FAIL — TypeScript/type error on `rotation` not existing on `MapLabel`, and/or assertion failure because `MapLabels` renders no `transform`.

- [ ] **Step 3: Add `rotation` to the `MapLabel` type**

In `src/lib/types.ts`, add the field to the `MapLabel` type:

```ts
export type MapLabel = {
  id: string;
  text: string;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  font_size: number;
  color: string | null;
  rotation: number; // degrees
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
```

- [ ] **Step 4: Render the rotation transform in `MapLabels`**

Replace the body of `src/components/MapLabels.tsx` with:

```tsx
import type { MapLabel } from "@/lib/types";

const SIZE = 1000;

/** Renders free-floating text labels (independent of zones) inside the map SVG. */
export default function MapLabels({ labels }: { labels: MapLabel[] }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {labels.map((l) => {
        const x = l.x * SIZE;
        const y = l.y * SIZE;
        return (
          <text
            key={l.id}
            x={x}
            y={y}
            transform={l.rotation ? `rotate(${l.rotation} ${x} ${y})` : undefined}
            fontSize={l.font_size}
            fill={l.color ?? "#3a3324"}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="var(--font-hand), cursive"
          >
            {l.text}
          </text>
        );
      })}
    </g>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- map-labels`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/components/MapLabels.tsx tests/map-labels.test.tsx
git commit -m "feat: add rotation to map labels and render it"
```

---

### Task 2: Remove hardcoded street labels from `BaseMap`

**Files:**
- Modify: `src/components/BaseMap.tsx:97-106` (delete the street label `<text>` block)
- Test: `tests/base-map.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `BaseMap` renders no real street names; the street/alley *shapes* remain.

- [ ] **Step 1: Write the failing test**

Create `tests/base-map.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import BaseMap from "../src/components/BaseMap";

describe("BaseMap", () => {
  it("does not render real street names (privacy)", () => {
    const { container } = render(
      <svg>
        <BaseMap />
      </svg>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/eastview/i);
    expect(text).not.toMatch(/baltimore/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- base-map`
Expected: FAIL — `BaseMap` still renders "Eastview Cir" and "Baltimore Drive".

- [ ] **Step 3: Delete the hardcoded street labels**

In `src/components/BaseMap.tsx`, delete this entire block (the `{/* Street labels */}` comment and all three `<text>` elements, lines 97-106):

```tsx
      {/* Street labels */}
      <text x="60" y="520" fontSize={32} fill="#7a6a44" transform="rotate(-82 60 520)" fontFamily={hand}>
        Eastview Cir
      </text>
      <text x="430" y="958" fontSize={32} fill="#7a6a44" fontFamily={hand}>
        Baltimore Drive
      </text>
      <text x="940" y="500" fontSize={22} fill="#9c8567" transform="rotate(90 940 500)" fontFamily={hand}>
        alley
      </text>
```

Leave all the street/alley *shape* paths (lines 17-27) intact. The `hand` constant is still used by the "house" label, so do not remove it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- base-map`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/BaseMap.tsx tests/base-map.test.tsx
git commit -m "feat: remove hardcoded street names from base map (privacy)"
```

---

### Task 3: Migration — add `rotation` column and seed generic street labels

**Files:**
- Create: `supabase/migrations/0004_map_label_rotation.sql`

**Interfaces:**
- Consumes: `map_labels` table from `0003_map_labels.sql`; `MapLabel.rotation` from Task 1.
- Produces: `map_labels.rotation real not null default 0`; three seeded rows (`Street`, `Drive`, `alley`) that replace the deleted hardcoded labels.

> No unit test — migrations are plain SQL applied to Supabase (via the SQL Editor, or `node scripts/migrate.mjs` if `SUPABASE_DB_URL` is set). Verification is the live check in Task 5. The migration is written idempotently (`add column if not exists`, guarded inserts) so re-running is safe.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_map_label_rotation.sql`:

```sql
-- Add rotation (degrees) to map labels, and seed the former hardcoded
-- street labels as generic, editable DB rows (privacy: no real names).
alter table map_labels add column if not exists rotation real not null default 0;

-- Seed generic street/alley labels at the old on-map positions.
-- Coordinates are normalized 0..1; MapLabels renders them center-anchored,
-- so these approximate the prior placement and may be nudged in the editor.
insert into map_labels (text, x, y, font_size, color, rotation)
select 'Street', 0.06, 0.52, 32, '#7a6a44', -82
where not exists (select 1 from map_labels where text = 'Street' and archived_at is null);

insert into map_labels (text, x, y, font_size, color, rotation)
select 'Drive', 0.50, 0.945, 32, '#7a6a44', 0
where not exists (select 1 from map_labels where text = 'Drive' and archived_at is null);

insert into map_labels (text, x, y, font_size, color, rotation)
select 'alley', 0.945, 0.50, 22, '#9c8567', 90
where not exists (select 1 from map_labels where text = 'alley' and archived_at is null);
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase SQL Editor (paste & run the file), OR run `node scripts/migrate.mjs` if `SUPABASE_DB_URL` is set in `.env.local`.
Expected: column added; three rows present in `map_labels`. Confirm with a quick query in the SQL Editor: `select text, rotation from map_labels where archived_at is null;`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_map_label_rotation.sql
git commit -m "feat: migration for map label rotation + seed generic streets"
```

---

### Task 4: API — accept `rotation` on create and update

**Files:**
- Modify: `src/app/api/map-labels/route.ts`

**Interfaces:**
- Consumes: `MapLabel.rotation` from Task 1.
- Produces: `POST /api/map-labels` accepts optional `rotation` (defaults to `0`); `PATCH /api/map-labels` accepts optional `rotation`.

> No unit test — this repo does not test API route handlers (they're coupled to the service-role Supabase client). Verified via `npm run build` (Step 3) and the live check in Task 5, consistent with existing route conventions.

- [ ] **Step 1: Add `rotation` to the request type**

In `src/app/api/map-labels/route.ts`, extend `LabelBody`:

```ts
type LabelBody = {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
  font_size?: number;
  color?: string;
  rotation?: number;
};
```

- [ ] **Step 2: Insert `rotation` in POST**

In the `POST` handler's `.insert({ ... })`, add the `rotation` field after `color`:

```ts
    .insert({
      text,
      x: clamp01(typeof body.x === "number" ? body.x : 0.5),
      y: clamp01(typeof body.y === "number" ? body.y : 0.5),
      font_size: typeof body.font_size === "number" ? body.font_size : 30,
      color: body.color ?? null,
      rotation: typeof body.rotation === "number" ? body.rotation : 0,
    })
```

- [ ] **Step 3: Update `rotation` in PATCH**

In the `PATCH` handler, after the `font_size` line, add:

```ts
  if (typeof body.font_size === "number") update.font_size = body.font_size;
  if (typeof body.rotation === "number") update.rotation = body.rotation;
  if (typeof body.color === "string") update.color = body.color;
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/map-labels/route.ts
git commit -m "feat: accept rotation in map-labels API"
```

---

### Task 5: Editor — rotation + font-size controls and rotated preview

**Files:**
- Modify: `src/components/LabelEditor.tsx`

**Interfaces:**
- Consumes: `MapLabel.rotation` (Task 1); `PATCH` accepting `rotation` + `font_size` (Task 4).
- Produces: the selected-label control row includes rotation (degrees) and font-size number inputs; saving PATCHes both; the editor preview rotates labels.

> No unit test — `LabelEditor` mounts and calls `getBrowserSupabase()` on render, which the repo does not mock in tests. Verified by the live check in Step 6 (this is the task that proves the whole feature end-to-end).

- [ ] **Step 1: Add edit state for rotation and font-size**

In `src/components/LabelEditor.tsx`, next to the existing `editColor` state (around line 19), add:

```ts
  const [editColor, setEditColor] = useState("#3a3324");
  const [editRotation, setEditRotation] = useState(0);
  const [editFontSize, setEditFontSize] = useState(30);
```

- [ ] **Step 2: Initialize the new state when a label is selected**

In `onLabelDown` (around lines 64-72), after `setEditColor(...)`, add:

```ts
    setEditText(l.text);
    setEditColor(l.color ?? "#3a3324");
    setEditRotation(l.rotation ?? 0);
    setEditFontSize(l.font_size);
```

- [ ] **Step 3: Send rotation + font-size on save**

In `saveSelected` (around lines 95-104), extend the PATCH body:

```ts
      body: JSON.stringify({
        id: selectedId,
        text: editText.trim() || undefined,
        color: editColor,
        rotation: editRotation,
        font_size: editFontSize,
      }),
```

- [ ] **Step 4: Add the rotation and font-size inputs to the control row**

In the `selected && (...)` control row (around lines 123-130), add two number inputs after the color input and before the "Save text" button:

```tsx
          <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} aria-label="label color" style={{ width: 44, height: 38, border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0" }} />
          <input type="number" value={editRotation} onChange={(e) => setEditRotation(Number(e.target.value))} aria-label="label rotation degrees" title="rotation (degrees)" style={{ ...ctrl, cursor: "text", width: 90 }} />
          <input type="number" value={editFontSize} onChange={(e) => setEditFontSize(Number(e.target.value))} aria-label="label font size" title="font size" style={{ ...ctrl, cursor: "text", width: 90 }} />
          <button style={{ ...ctrl, background: "#9bbf4a", fontWeight: 600 }} onClick={saveSelected}>Save text</button>
```

- [ ] **Step 5: Rotate labels in the editor preview**

In the editable-labels render (around lines 159-175), add a `transform` to the `<text>`:

```tsx
            <text
              x={l.x * SIZE}
              y={l.y * SIZE}
              transform={l.rotation ? `rotate(${l.rotation} ${l.x * SIZE} ${l.y * SIZE})` : undefined}
              fontSize={l.font_size}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={l.color ?? "#3a3324"}
              fontFamily="var(--font-hand), cursive"
              stroke={selectedId === l.id ? "#8e3b5e" : "none"}
              strokeWidth={selectedId === l.id ? 0.6 : 0}
            >
              {l.text}
            </text>
```

- [ ] **Step 6: Verify — build, tests, and live check**

Run: `npm test` — Expected: all suites pass (including Task 1 & 2 tests).
Run: `npm run build` — Expected: success.
Live check (per AGENTS workflow — the map page screenshot can hang, so rasterize the SVG with `sharp`, or use the preview tool against `/` and `/editor/labels`):
  - The main map shows `Street`, `Drive`, `alley` at roughly the old positions/angles, no real names.
  - In `/editor/labels`, selecting a label shows rotation + font-size inputs; changing rotation rotates the preview; Save persists (reload confirms).
  - Add a small label inside the raised-bed zone with a reduced font size to confirm the in-zone annotation use case.
  - If a seeded street label sits noticeably off, drag/rotate it in the editor and Save (no migration change needed).

- [ ] **Step 7: Commit**

```bash
git add src/components/LabelEditor.tsx
git commit -m "feat: rotation + font-size controls in label editor"
```

---

## Self-Review

**Spec coverage:**
- Migration adds `rotation` + seeds 3 generic rows → Task 3. ✓
- `MapLabel.rotation` type + `MapLabels` transform → Task 1. ✓
- `BaseMap` street `<text>` removed → Task 2. ✓
- API accepts `rotation` (POST/PATCH) → Task 4. ✓
- Editor rotation + font-size controls + rotated preview → Task 5. ✓
- In-zone sub-bed annotation use case → verified in Task 5 Step 6 (uses existing free-placement; no new code needed). ✓
- Privacy default text generic → Task 3 seed + Global Constraints. ✓
- Done-when criteria (column exists, no real names, editor edits persist, build/test green, live check) → covered across Tasks 2/3/5. ✓

**Placeholder scan:** No TBD/TODO; all code steps show complete code; all commands have expected output. ✓

**Type consistency:** `rotation: number` used identically in `MapLabel` (Task 1), `LabelBody` (Task 4), `MapLabels`/`LabelEditor` transforms (Tasks 1/5), and the migration column (Task 3). `font_size` matches existing field name. ✓
