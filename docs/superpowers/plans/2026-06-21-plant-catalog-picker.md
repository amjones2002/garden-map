# Plant Catalog Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text "add a plant" input in a zone with a catalog-backed typeahead picker that links entries to `plant_catalog`, allows a free-text escape hatch, supports an optional planting date, lets users stage and save several plants at once, and warns (but doesn't block) on truly-duplicate entries.

**Architecture:** All decision logic (search ranking, query sanitizing, duplicate detection) lives in a new pure module `src/lib/plant-catalog.ts` with unit tests. A new public read endpoint `GET /api/plant-catalog` runs the catalog search. The existing `POST /api/plants` gains array (batch) support. A new `PlantPicker` client component holds the typeahead + staging UI and is wired into `ZonePanel`. One migration adds an optional `planted_date` column.

**Tech Stack:** Next.js 16 (App Router, route handlers), Supabase (`@supabase/supabase-js`), React 19, TypeScript, Vitest (jsdom).

## Global Constraints

- **Read the relevant Next.js guide in `node_modules/next/dist/docs/` before writing route/component code** — this Next.js (16.2.9) has breaking changes vs. training data (per AGENTS.md).
- Writes go only through route handlers using the service-role client `getServerSupabase()` from `src/lib/supabase/server.ts` (RLS blocks anon writes). Never import the server Supabase client into a client component.
- Mutating endpoints must be gated with `if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });`. Read-only endpoints are not gated.
- Date columns are Postgres `date`/`timestamptz` and typed `string | null` in TypeScript (cf. `Purchase.purchase_date`).
- Tests live in `tests/**/*.test.{ts,tsx}` and run with `npm test` (`vitest run`). Pure logic is tested in `src/lib/*`; route handlers and components are kept thin and not directly unit-tested (existing project convention).
- Migrations are plain SQL files in `supabase/migrations/`, applied with `node scripts/migrate.mjs <filename>`. Use `if not exists` for idempotency.

---

### Task 1: Add `planted_date` to the data model

**Files:**
- Create: `supabase/migrations/0004_plant_planted_date.sql`
- Modify: `src/lib/types.ts` (the `Plant` type, ~lines 35-42)

**Interfaces:**
- Consumes: nothing.
- Produces: `Plant.planted_date: string | null` — relied on by Tasks 4, 5, 6.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0004_plant_planted_date.sql`:

```sql
-- Add an optional planting date to zone plant entries.
-- Lets the same species appear more than once with different ages.
alter table plants add column if not exists planted_date date;
```

- [ ] **Step 2: Add the field to the `Plant` type**

In `src/lib/types.ts`, change the `Plant` type to include `planted_date`:

```ts
export type Plant = {
  id: string;
  zone_id: string;
  common_name: string;
  botanical_name: string | null;
  catalog_id: string | null;
  planted_date: string | null;
  sort_order: number;
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_plant_planted_date.sql src/lib/types.ts
git commit -m "feat: add optional planted_date to plants"
```

Note: applying the migration to the live DB (`node scripts/migrate.mjs 0004_plant_planted_date.sql`) requires `SUPABASE_DB_URL` and is run by the maintainer, not part of this task's verification.

---

### Task 2: Catalog search ranking + query sanitizer (pure logic)

**Files:**
- Create: `src/lib/plant-catalog.ts`
- Test: `tests/plant-catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CatalogResult = { id: string; scientific_name: string; common_name: string | null; other_common_names: string | null }`
  - `sanitizeQuery(q: string): string` — trims and strips characters that break the Supabase `.or()` filter builder (`%`, `,`, `(`, `)`).
  - `rankCatalogResults(rows: CatalogResult[], q: string): CatalogResult[]` — prefix matches first, then substring, each tier alphabetical by common name (falling back to scientific name when common name is null).

- [ ] **Step 1: Write the failing tests**

Create `tests/plant-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeQuery, rankCatalogResults, type CatalogResult } from "../src/lib/plant-catalog";

const mk = (id: string, common: string | null, sci: string): CatalogResult => ({
  id,
  scientific_name: sci,
  common_name: common,
  other_common_names: null,
});

describe("sanitizeQuery", () => {
  it("trims whitespace", () => {
    expect(sanitizeQuery("  sage  ")).toBe("sage");
  });
  it("strips characters that break the .or() filter builder", () => {
    expect(sanitizeQuery("sa%ge,(x)")).toBe("sagex");
  });
});

describe("rankCatalogResults", () => {
  it("ranks prefix matches above substring-only matches", () => {
    const rows = [
      mk("1", "Cardinal Flower", "Lobelia cardinalis"), // substring 'card'
      mk("2", "Cardplant", "Aaa bbb"), // prefix 'card'
    ];
    const out = rankCatalogResults(rows, "card");
    expect(out.map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("sorts alphabetically within a tier by common name", () => {
    const rows = [
      mk("b", "Sage, White", "Salvia apiana"),
      mk("a", "Sage, Autumn", "Salvia greggii"),
    ];
    const out = rankCatalogResults(rows, "sage");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("falls back to scientific name when common name is null", () => {
    const rows = [
      mk("z", null, "Zinnia grandiflora"),
      mk("a", null, "Aquilegia canadensis"),
    ];
    const out = rankCatalogResults(rows, "a");
    expect(out.map((r) => r.id)).toEqual(["a", "z"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- plant-catalog`
Expected: FAIL — cannot resolve `../src/lib/plant-catalog`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/plant-catalog.ts`:

```ts
export type CatalogResult = {
  id: string;
  scientific_name: string;
  common_name: string | null;
  other_common_names: string | null;
};

/** Strip whitespace and characters that break Supabase's `.or()` filter builder. */
export function sanitizeQuery(q: string): string {
  return q.trim().replace(/[%,()]/g, "");
}

const sortName = (r: CatalogResult): string =>
  (r.common_name ?? r.scientific_name).toLowerCase();

/**
 * Rank catalog matches: names that *start with* the query come first,
 * then substring-only matches. Each tier is alphabetical by display name.
 */
export function rankCatalogResults(rows: CatalogResult[], q: string): CatalogResult[] {
  const needle = q.trim().toLowerCase();
  const isPrefix = (r: CatalogResult): boolean =>
    (r.common_name ?? "").toLowerCase().startsWith(needle) ||
    r.scientific_name.toLowerCase().startsWith(needle);

  return [...rows].sort((a, b) => {
    const ap = isPrefix(a);
    const bp = isPrefix(b);
    if (ap !== bp) return ap ? -1 : 1;
    return sortName(a).localeCompare(sortName(b));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- plant-catalog`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-catalog.ts tests/plant-catalog.test.ts
git commit -m "feat: catalog search ranking and query sanitizer"
```

---

### Task 3: Duplicate detection (pure logic)

**Files:**
- Modify: `src/lib/plant-catalog.ts`
- Modify: `tests/plant-catalog.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (self-contained types below).
- Produces:
  - `type PlantEntry = { catalog_id: string | null; common_name: string; planted_date: string | null }`
  - `isSamePlant(a: PlantEntry, b: PlantEntry): boolean` — same `catalog_id` when both are catalog-linked; otherwise case-insensitive `common_name` match. Two entries with the same `common_name` but different non-null `catalog_id`s are NOT the same.
  - `isDuplicateEntry(a: PlantEntry, b: PlantEntry): boolean` — `isSamePlant` AND (both dates blank OR equal).
  - `findExistingDuplicate(entry: PlantEntry, existing: PlantEntry[]): boolean` — true if any existing entry is a duplicate of `entry`.
  - `flagBatchDuplicates(rows: PlantEntry[]): boolean[]` — index-aligned; `true` where a row duplicates an earlier row in the same array.

- [ ] **Step 1: Write the failing tests**

Append to `tests/plant-catalog.test.ts`:

```ts
import {
  isSamePlant,
  isDuplicateEntry,
  findExistingDuplicate,
  flagBatchDuplicates,
  type PlantEntry,
} from "../src/lib/plant-catalog";

const entry = (over: Partial<PlantEntry> = {}): PlantEntry => ({
  catalog_id: null,
  common_name: "Gregg's Mistflower",
  planted_date: null,
  ...over,
});

describe("isSamePlant", () => {
  it("matches catalog-linked entries by catalog_id", () => {
    expect(isSamePlant(entry({ catalog_id: "x" }), entry({ catalog_id: "x", common_name: "other" }))).toBe(true);
    expect(isSamePlant(entry({ catalog_id: "x" }), entry({ catalog_id: "y" }))).toBe(false);
  });
  it("matches custom entries by case-insensitive common name", () => {
    expect(isSamePlant(entry({ common_name: "Sage" }), entry({ common_name: "sage" }))).toBe(true);
  });
});

describe("isDuplicateEntry", () => {
  it("is true for same plant with both dates blank", () => {
    expect(isDuplicateEntry(entry({ catalog_id: "x" }), entry({ catalog_id: "x" }))).toBe(true);
  });
  it("is true for same plant with equal dates", () => {
    expect(
      isDuplicateEntry(entry({ catalog_id: "x", planted_date: "2025-01-01" }), entry({ catalog_id: "x", planted_date: "2025-01-01" })),
    ).toBe(true);
  });
  it("is false for same plant with different dates", () => {
    expect(
      isDuplicateEntry(entry({ catalog_id: "x", planted_date: "2024-01-01" }), entry({ catalog_id: "x", planted_date: "2025-01-01" })),
    ).toBe(false);
  });
});

describe("findExistingDuplicate", () => {
  it("detects a duplicate in the existing list", () => {
    const existing = [entry({ catalog_id: "x" })];
    expect(findExistingDuplicate(entry({ catalog_id: "x" }), existing)).toBe(true);
    expect(findExistingDuplicate(entry({ catalog_id: "y" }), existing)).toBe(false);
  });
});

describe("flagBatchDuplicates", () => {
  it("flags later rows that duplicate an earlier row", () => {
    const rows = [
      entry({ catalog_id: "x" }),
      entry({ catalog_id: "x" }), // dup of row 0
      entry({ catalog_id: "x", planted_date: "2025-01-01" }), // not a dup (diff date)
    ];
    expect(flagBatchDuplicates(rows)).toEqual([false, true, false]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- plant-catalog`
Expected: FAIL — `isSamePlant` etc. not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/plant-catalog.ts`:

```ts
export type PlantEntry = {
  catalog_id: string | null;
  common_name: string;
  planted_date: string | null;
};

/** Same species: by catalog_id when both linked, else case-insensitive common_name. */
export function isSamePlant(a: PlantEntry, b: PlantEntry): boolean {
  if (a.catalog_id && b.catalog_id) return a.catalog_id === b.catalog_id;
  if (a.catalog_id || b.catalog_id) return false;
  return a.common_name.trim().toLowerCase() === b.common_name.trim().toLowerCase();
}

const blank = (d: string | null): boolean => d === null || d.trim() === "";

/** Truly-duplicate: same plant AND (both dates blank OR equal). */
export function isDuplicateEntry(a: PlantEntry, b: PlantEntry): boolean {
  if (!isSamePlant(a, b)) return false;
  if (blank(a.planted_date) && blank(b.planted_date)) return true;
  return a.planted_date === b.planted_date;
}

export function findExistingDuplicate(entry: PlantEntry, existing: PlantEntry[]): boolean {
  return existing.some((e) => isDuplicateEntry(entry, e));
}

/** Index-aligned flags: true where a row duplicates an earlier row in the array. */
export function flagBatchDuplicates(rows: PlantEntry[]): boolean[] {
  return rows.map((row, i) => rows.slice(0, i).some((earlier) => isDuplicateEntry(row, earlier)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- plant-catalog`
Expected: PASS (all tests, including the Task 2 set).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-catalog.ts tests/plant-catalog.test.ts
git commit -m "feat: plant duplicate detection logic"
```

---

### Task 4: Catalog search endpoint

**Files:**
- Create: `src/app/api/plant-catalog/route.ts`

**Interfaces:**
- Consumes: `sanitizeQuery`, `rankCatalogResults`, `CatalogResult` from `src/lib/plant-catalog.ts` (Task 2).
- Produces: `GET /api/plant-catalog?q=<text>` → `{ results: CatalogResult[] }` (max 20). Used by the `PlantPicker` (Task 6).

- [ ] **Step 1: Read the Next.js route handler guide**

Skim the route-handler doc under `node_modules/next/dist/docs/` (search for "route" / "Route Handlers") to confirm the `GET(req: Request)` signature and `NextResponse.json` usage for this Next version. Match the style of `src/app/api/zone-photos/upload-url/route.ts`.

- [ ] **Step 2: Write the route**

Create `src/app/api/plant-catalog/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeQuery, rankCatalogResults, type CatalogResult } from "@/lib/plant-catalog";

/** Public search over the plant catalog. GET ?q=<text>. Returns up to 20 ranked matches. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const q = sanitizeQuery(raw);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("plant_catalog")
    .select("id, scientific_name, common_name, other_common_names")
    .or(`common_name.ilike.%${q}%,scientific_name.ilike.%${q}%`)
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const results = rankCatalogResults((data ?? []) as CatalogResult[], q);
  return NextResponse.json({ results });
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional, needs env)**

If `.env.local` is configured, run `npm run dev` and request `/api/plant-catalog?q=sage`; expect a JSON `{ results: [...] }`. Skip if env is unavailable — the logic is covered by Task 2's unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/plant-catalog/route.ts
git commit -m "feat: plant catalog search endpoint"
```

---

### Task 5: Batch insert support in `POST /api/plants`

**Files:**
- Modify: `src/app/api/plants/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `POST /api/plants` accepts either the existing single shape `{ zone_id, common_name, botanical_name?, catalog_id?, planted_date? }` or a batch `{ zone_id, rows: [...] }`. Returns `{ inserted: number, rows: Plant[] }` for the batch path (still `201` with the single row for the single path). Used by `PlantPicker` (Task 6).

- [ ] **Step 1: Read the existing route**

Re-read `src/app/api/plants/route.ts` so the new code matches its `requireEdit` gate and error style.

- [ ] **Step 2: Rewrite the POST handler**

Replace the `POST` function in `src/app/api/plants/route.ts` with this (leave `DELETE` unchanged):

```ts
type PlantInput = {
  common_name?: string;
  botanical_name?: string | null;
  catalog_id?: string | null;
  planted_date?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizePlant(zone_id: string, p: PlantInput) {
  const common_name = (p.common_name ?? "").trim();
  if (!common_name) return { error: "common_name required" as const };
  if (p.catalog_id != null && !UUID_RE.test(p.catalog_id)) return { error: "invalid catalog_id" as const };
  const planted = p.planted_date?.trim() || null;
  if (planted && Number.isNaN(Date.parse(planted))) return { error: "invalid planted_date" as const };
  return {
    value: {
      zone_id,
      common_name,
      botanical_name: p.botanical_name ?? null,
      catalog_id: p.catalog_id ?? null,
      planted_date: planted,
    },
  };
}

/** Add one or many plants to a zone's curated list. Gated. */
export async function POST(req: Request) {
  if (!(await requireEdit())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  let body: { zone_id?: string; rows?: PlantInput[] } & PlantInput = {};
  try {
    body = await req.json();
  } catch {
    // empty
  }
  const zone_id = body.zone_id;
  if (!zone_id) return NextResponse.json({ error: "zone_id required" }, { status: 400 });

  const inputs: PlantInput[] = Array.isArray(body.rows) ? body.rows : [body];
  if (inputs.length === 0) return NextResponse.json({ error: "no rows" }, { status: 400 });

  const toInsert = [];
  for (const p of inputs) {
    const r = normalizePlant(zone_id, p);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    toInsert.push(r.value);
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("plants").insert(toInsert).select();
  if (error) return NextResponse.json({ error: error.message, inserted: 0 }, { status: 400 });
  return NextResponse.json({ inserted: data.length, rows: data }, { status: 201 });
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/plants/route.ts
git commit -m "feat: batch insert support for POST /api/plants"
```

Note: this changes the single-add success response from the bare row to `{ inserted, rows }`. `ZonePanel`'s current `addPlant` ignores the response body and calls `load()`, so it is unaffected; Task 6 replaces that code path entirely.

---

### Task 6: `PlantPicker` component + ZonePanel wiring

**Files:**
- Create: `src/components/PlantPicker.tsx`
- Modify: `src/components/ZonePanel.tsx` (the `newPlant` state, `addPlant`, and the add-plant `<form>` ~lines 36, 57-69, 211-248; plus the plant list `<li>` ~lines 213-227 to show `planted_date`)

**Interfaces:**
- Consumes: `CatalogResult`, `PlantEntry`, `findExistingDuplicate`, `flagBatchDuplicates` from `src/lib/plant-catalog.ts`; `GET /api/plant-catalog` (Task 4); `POST /api/plants` batch shape (Task 5); `Plant` type with `planted_date` (Task 1).
- Produces: `<PlantPicker zoneId={string} existing={Plant[]} onSaved={() => void} />` — renders the typeahead + staging list and posts the batch.

- [ ] **Step 1: Read the Next.js client-component guidance**

Confirm the `"use client"` directive convention by skimming an existing client component (`src/components/ZonePanel.tsx` already uses it) — no new framework features are needed here.

- [ ] **Step 2: Write the `PlantPicker` component**

Create `src/components/PlantPicker.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { Plant } from "@/lib/types";
import {
  findExistingDuplicate,
  flagBatchDuplicates,
  type CatalogResult,
  type PlantEntry,
} from "@/lib/plant-catalog";

type StagedRow = {
  common_name: string;
  botanical_name: string | null;
  catalog_id: string | null;
  planted_date: string | null;
};

const input: React.CSSProperties = {
  minHeight: 38,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #cbb994",
};

export default function PlantPicker({
  zoneId,
  existing,
  onSaved,
}: {
  zoneId: string;
  existing: Plant[];
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [picked, setPicked] = useState<CatalogResult | null>(null);
  const [date, setDate] = useState("");
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced catalog search; clears the chosen match when the text changes.
  useEffect(() => {
    if (picked && text === (picked.common_name ?? picked.scientific_name)) return;
    if (debounce.current) clearTimeout(debounce.current);
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/plant-catalog?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(((await res.json()).results ?? []) as CatalogResult[]);
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [text, picked]);

  function choose(r: CatalogResult) {
    setPicked(r);
    setText(r.common_name ?? r.scientific_name);
    setResults([]);
  }

  function chooseCustom() {
    setPicked(null);
    setResults([]);
  }

  const existingEntries: PlantEntry[] = existing.map((p) => ({
    catalog_id: p.catalog_id,
    common_name: p.common_name,
    planted_date: p.planted_date,
  }));

  function addRow() {
    const name = picked ? picked.common_name ?? picked.scientific_name : text.trim();
    if (!name) return;
    const row: StagedRow = {
      common_name: name,
      botanical_name: picked ? picked.scientific_name : null,
      catalog_id: picked ? picked.id : null,
      planted_date: date.trim() || null,
    };
    setStaged((s) => [...s, row]);
    setText("");
    setPicked(null);
    setDate("");
    setResults([]);
  }

  function removeRow(i: number) {
    setStaged((s) => s.filter((_, idx) => idx !== i));
  }

  const batchFlags = flagBatchDuplicates(staged);
  const dupFlags = staged.map(
    (r, i) => batchFlags[i] || findExistingDuplicate(r, existingEntries),
  );

  async function save() {
    if (staged.length === 0) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_id: zoneId, rows: staged }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Save failed — please try again.");
      return;
    }
    setStaged([]);
    onSaved();
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, position: "relative" }}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPicked(null);
          }}
          placeholder="search the catalog…"
          aria-label="search the plant catalog"
          style={{ ...input, flex: 1 }}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="planting date"
          style={input}
        />
        <button
          type="button"
          onClick={addRow}
          style={{ ...input, background: "#e3dac3", cursor: "pointer" }}
        >
          + Add row
        </button>
      </div>

      {results.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "2px 0 0",
            padding: 4,
            border: "1px solid #cbb994",
            borderRadius: 8,
            background: "#fff",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => choose(r)}
                style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "6px 8px", cursor: "pointer" }}
              >
                <strong>{r.common_name ?? r.scientific_name}</strong>
                {r.common_name && <em style={{ color: "#8a8268" }}> — {r.scientific_name}</em>}
              </button>
            </li>
          ))}
          {text.trim().length >= 2 && (
            <li>
              <button
                type="button"
                onClick={chooseCustom}
                style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "6px 8px", cursor: "pointer", color: "#7a6a44" }}
              >
                Add “{text.trim()}” as a custom plant
              </button>
            </li>
          )}
        </ul>
      )}

      {staged.length > 0 && (
        <>
          <ul style={{ marginTop: 8 }}>
            {staged.map((r, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {r.common_name}
                  {r.botanical_name ? <em style={{ color: "#8a8268" }}> — {r.botanical_name}</em> : null}
                  {r.planted_date ? <span style={{ color: "#8a8268" }}> · {r.planted_date}</span> : null}
                  {dupFlags[i] && (
                    <span style={{ color: "#8e3b5e" }}> · already in this list</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove ${r.common_name}`}
                  style={{ border: "none", background: "transparent", color: "#8e3b5e", cursor: "pointer" }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{ minHeight: 38, padding: "0 12px", borderRadius: 8, border: "1px solid #cbb994", background: "#9bbf4a", cursor: "pointer" }}
          >
            {saving ? "Saving…" : `Save ${staged.length} plant${staged.length === 1 ? "" : "s"}`}
          </button>
          {error && <p style={{ color: "#8e3b5e", fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `ZonePanel`**

In `src/components/ZonePanel.tsx`:

1. Add the import near the other imports at the top:

```tsx
import PlantPicker from "./PlantPicker";
```

2. Remove the now-unused `newPlant` state (line ~36: `const [newPlant, setNewPlant] = useState("");`) and the `addPlant` function (lines ~57-69).

3. Replace the add-plant `<form>` block (the `{unlocked && (<form>…</form>)}` at ~lines 229-248) with:

```tsx
{unlocked && (
  <PlantPicker zoneId={zone.id} existing={plants} onSaved={load} />
)}
```

4. Show the planting date in the existing plant list. Change the plant `<li>`'s `<span>` (lines ~216-219) to:

```tsx
<span>
  {p.common_name}
  {p.botanical_name ? <em style={{ color: "#8a8268" }}> — {p.botanical_name}</em> : null}
  {p.planted_date ? <span style={{ color: "#8a8268" }}> · {p.planted_date}</span> : null}
</span>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. (If `tsc` flags `busy` as unused after removing `addPlant`, also remove the now-orphaned `busy`/`setBusy` usages that only served `addPlant` — but `removePlant` still uses `busy`, so leave it.)

- [ ] **Step 5: Commit**

```bash
git add src/components/PlantPicker.tsx src/components/ZonePanel.tsx
git commit -m "feat: catalog-backed plant picker with batch staging in ZonePanel"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `plant-catalog` tests.

- [ ] **Step 2: Typecheck and lint the whole project**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (optional, needs env + applied migration)**

With `.env.local` set and migration `0004` applied: `npm run dev`, open a zone in edit mode, search the catalog, stage two plants (one catalog, one custom, give one a date), save, and confirm they appear in "Currently planted." Re-stage an identical entry and confirm the "already in this list" warning appears but Save still works.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for plant catalog picker"
```

(If nothing changed in Steps 1-3, skip this commit.)

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), search endpoint (Task 4) + ranking/sanitizer (Task 2), picker UI with escape hatch + planting date + staging (Task 6), duplicate detection same-species/same-or-blank-date both against existing and within batch (Task 3, surfaced in Task 6), batch insert API with validation + all-or-nothing (Task 5), error handling preserving the staging list (Task 6 `save`), and tests for all `lib/` logic (Tasks 2-3). All spec sections map to a task.
- **Type consistency:** `CatalogResult`, `PlantEntry`, `StagedRow`, and the `{ inserted, rows }` response shape are used consistently across tasks; `planted_date: string | null` is threaded from Task 1 through 5 and 6.
- **Out of scope confirmed:** no CSV import, no tracker changes.
