# Purchase-Driven Plant Intake + Catalog Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make purchase the single intake point for plants — drop the standalone `plants` list, derive a zone's "Currently planted" from its purchases (`status = 'planted'`), and give `PurchaseForm` a catalog-backed typeahead that links each plant to `plant_catalog` while still allowing off-catalog entries.

**Architecture:** Search/ranking logic is a pure, tested module `src/lib/plant-catalog.ts`. A new public read endpoint `GET /api/plant-catalog` runs the search. A reusable `PlantField` component provides the typeahead and is dropped into `PurchaseForm`, which already persists `catalog_id` through the existing `/api/purchases` route. The `plants` table, its `/api/plants` route, the standalone add-plant box in `ZonePanel`, and the `also_add_to_plant_list` mirror are removed; `ZonePanel` reads currently-planted plants from purchases.

**Tech Stack:** Next.js 16 (App Router, route handlers), Supabase (`@supabase/supabase-js`), React 19, TypeScript, Vitest (jsdom).

## Global Constraints

- **Read the relevant Next.js guide in `node_modules/next/dist/docs/` before writing route/component code** — this Next.js (16.2.9) has breaking changes vs. training data (per AGENTS.md).
- Writes go only through route handlers using the service-role client `getServerSupabase()` from `src/lib/supabase/server.ts`. Never import the server Supabase client into a client component.
- Mutating endpoints must be gated with `if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });`. Read-only endpoints are not gated.
- Client components read data with the browser client `getBrowserSupabase()` from `src/lib/supabase/client.ts` (RLS allows public reads).
- Tests live in `tests/**/*.test.{ts,tsx}` and run with `npm test` (`vitest run`). Pure logic is tested in `src/lib/*`; route handlers and components are kept thin and not directly unit-tested (existing project convention).
- Migrations are plain SQL files in `supabase/migrations/`, applied with `node scripts/migrate.mjs <filename>`. Use `if exists`/`if not exists` for idempotency. Applying to the live DB is done by the maintainer, not part of task verification.

---

### Task 1: Catalog search ranking + query sanitizer (pure logic)

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
      mk("1", "Pineapple Sage", "Salvia elegans"), // 'sage' is a substring, not a prefix
      mk("2", "Sagebrush", "Artemisia tridentata"), // 'sage' is a prefix
    ];
    const out = rankCatalogResults(rows, "sage");
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

### Task 2: Catalog search endpoint

**Files:**
- Create: `src/app/api/plant-catalog/route.ts`

**Interfaces:**
- Consumes: `sanitizeQuery`, `rankCatalogResults`, `CatalogResult` from `src/lib/plant-catalog.ts` (Task 1).
- Produces: `GET /api/plant-catalog?q=<text>` → `{ results: CatalogResult[] }` (max 20). Used by `PlantField` (Task 3).

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

If `.env.local` is configured, run `npm run dev` and request `/api/plant-catalog?q=sage`; expect JSON `{ results: [...] }`. Skip if env is unavailable — the logic is covered by Task 1's unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/plant-catalog/route.ts
git commit -m "feat: plant catalog search endpoint"
```

---

### Task 3: `PlantField` catalog typeahead component

**Files:**
- Create: `src/components/PlantField.tsx`

**Interfaces:**
- Consumes: `CatalogResult` from `src/lib/plant-catalog.ts` (Task 1); `GET /api/plant-catalog` (Task 2).
- Produces: a controlled component

  ```tsx
  <PlantField
    commonName={string}
    botanicalName={string}
    onChange={(v: { common_name: string; botanical_name: string; catalog_id: string | null }) => void}
  />
  ```

  It owns the search dropdown only; the parent owns the field values. Picking a catalog
  match calls `onChange` with all three fields; typing free text calls `onChange` with the
  typed `common_name`, the current `botanical_name`, and `catalog_id: null`.

- [ ] **Step 1: Confirm the client-component convention**

`src/components/PurchaseForm.tsx` already uses `"use client"`; this component follows the same pattern. No new framework features needed.

- [ ] **Step 2: Write the component**

Create `src/components/PlantField.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { CatalogResult } from "@/lib/plant-catalog";

const field: React.CSSProperties = {
  minHeight: 38,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #cbb994",
  width: "100%",
  boxSizing: "border-box",
};

export default function PlantField({
  commonName,
  botanicalName,
  onChange,
}: {
  commonName: string;
  botanicalName: string;
  onChange: (v: { common_name: string; botanical_name: string; catalog_id: string | null }) => void;
}) {
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = commonName.trim();
    if (!open || q.length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plant-catalog?q=${encodeURIComponent(q)}`);
        if (res.ok) setResults(((await res.json()).results ?? []) as CatalogResult[]);
        else setResults([]);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [commonName, open]);

  function pick(r: CatalogResult) {
    onChange({
      common_name: r.common_name ?? r.scientific_name,
      botanical_name: r.scientific_name,
      catalog_id: r.id,
    });
    setResults([]);
    setOpen(false);
  }

  function useCustom() {
    onChange({ common_name: commonName.trim(), botanical_name: botanicalName, catalog_id: null });
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        style={field}
        value={commonName}
        placeholder="search the catalog…"
        aria-label="plant name (search catalog)"
        onChange={(e) => {
          setOpen(true);
          onChange({ common_name: e.target.value, botanical_name: botanicalName, catalog_id: null });
        }}
        onFocus={() => setOpen(true)}
        required
      />
      {open && results.length > 0 && (
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
            position: "absolute",
            zIndex: 80,
            width: "100%",
          }}
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pick(r)}
                style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "6px 8px", cursor: "pointer" }}
              >
                <strong>{r.common_name ?? r.scientific_name}</strong>
                {r.common_name && <em style={{ color: "#8a8268" }}> — {r.scientific_name}</em>}
              </button>
            </li>
          ))}
          {commonName.trim().length >= 2 && (
            <li>
              <button
                type="button"
                onClick={useCustom}
                style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "6px 8px", cursor: "pointer", color: "#7a6a44" }}
              >
                Use “{commonName.trim()}” as a custom plant
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/PlantField.tsx
git commit -m "feat: catalog typeahead PlantField component"
```

---

### Task 4: Wire `PlantField` into `PurchaseForm`; remove the mirror checkbox

**Files:**
- Modify: `src/components/PurchaseForm.tsx`

**Interfaces:**
- Consumes: `PlantField` (Task 3).
- Produces: `PurchaseForm` submit payload now includes `catalog_id: string | null`; the `also_add_to_plant_list` field is gone.

- [ ] **Step 1: Add `catalog_id` state and the import**

In `src/components/PurchaseForm.tsx`, add near the other imports:

```tsx
import PlantField from "./PlantField";
```

Add a `catalogId` state alongside `common`/`botanical` (after line ~35):

```tsx
const [catalogId, setCatalogId] = useState<string | null>(initial?.catalog_id ?? null);
```

- [ ] **Step 2: Replace the plant-name + botanical-name inputs**

Replace the two `<div>` blocks for "Plant name *" and "Botanical name" (lines ~101-108) with:

```tsx
<div>
  <label style={label}>Plant name *</label>
  <PlantField
    commonName={common}
    botanicalName={botanical ?? ""}
    onChange={(v) => {
      setCommon(v.common_name);
      setBotanical(v.botanical_name);
      setCatalogId(v.catalog_id);
    }}
  />
</div>
<div>
  <label style={label}>Botanical name</label>
  <input style={field} value={botanical ?? ""} onChange={(e) => setBotanical(e.target.value)} />
</div>
```

(The botanical-name input stays editable for custom plants; picking a catalog match fills it automatically.)

- [ ] **Step 3: Add `catalog_id` to the payload, remove `also_add_to_plant_list`**

In `submit`, change the `payload` object (lines ~73-86): add `catalog_id: catalogId,` and remove the `also_add_to_plant_list: alsoAdd,` line.

- [ ] **Step 4: Remove the mirror checkbox and its state**

Remove the `alsoAdd` state (line ~44: `const [alsoAdd, setAlsoAdd] = useState(...)`) and the checkbox block (lines ~164-168, the `{!initial && zoneId && (<label>… also add to this zone's plant list …</label>)}`).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (no unused `alsoAdd`/`setAlsoAdd`).

- [ ] **Step 6: Commit**

```bash
git add src/components/PurchaseForm.tsx
git commit -m "feat: catalog picker in PurchaseForm; drop plant-list mirror checkbox"
```

---

### Task 5: Remove the `also_add_to_plant_list` mirror from the purchases API; delete `/api/plants`

**Files:**
- Modify: `src/app/api/purchases/route.ts`
- Delete: `src/app/api/plants/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /api/purchases` no longer writes to `plants`; `/api/plants` no longer exists.

- [ ] **Step 1: Remove the mirror block and field**

In `src/app/api/purchases/route.ts`:
- Delete the block in `POST` that mirrors into `plants` (lines ~51-59, the
  `if (body.also_add_to_plant_list && fields.zone_id) { … supabase.from("plants").insert(…) }`).
- Remove `also_add_to_plant_list?: boolean;` from the `PurchaseInput` type (line ~18).

- [ ] **Step 2: Delete the plants route**

```bash
git rm src/app/api/plants/route.ts
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/purchases/route.ts
git commit -m "refactor: remove plants mirror from purchases API and delete /api/plants"
```

---

### Task 6: Derive "Currently planted" from purchases in `ZonePanel`; remove the add-plant UI

**Files:**
- Modify: `src/components/ZonePanel.tsx`

**Interfaces:**
- Consumes: purchases with `status = 'planted'` for the zone (read via `getBrowserSupabase()`).
- Produces: no `plants` reads/writes anywhere in the component.

- [ ] **Step 1: Remove plant state and queries**

In `src/components/ZonePanel.tsx`:
- Remove the `Plant` import from `@/lib/types` (keep `Zone`, `Purchase`, `ZonePhoto`).
- Remove `const [plants, setPlants] = useState<Plant[]>([]);` (line ~33).
- Remove `const [newPlant, setNewPlant] = useState("");` (line ~36) and `const [busy, setBusy] = useState(false);` if it is only used by the removed plant functions (it is — see Step 4).
- In `load` (lines ~41-51), remove the `plants` query from the `Promise.all` and the `setPlants(...)` line. Add a query for currently-planted purchases:

```tsx
const load = useCallback(async () => {
  const sb = getBrowserSupabase();
  const [planted, pu, ph] = await Promise.all([
    sb.from("purchases").select("*").eq("zone_id", zone.id).eq("status", "planted").order("common_name"),
    sb.from("purchases").select("*").eq("zone_id", zone.id).order("created_at", { ascending: false }).limit(5),
    sb.from("zone_photos").select("*").eq("zone_id", zone.id),
  ]);
  setPlanted((planted.data ?? []) as Purchase[]);
  setPurchases((pu.data ?? []) as Purchase[]);
  setPhotos(sortChronological((ph.data ?? []) as ZonePhoto[]));
}, [zone.id]);
```

Add the state for it near the other `useState`s:

```tsx
const [planted, setPlanted] = useState<Purchase[]>([]);
```

- [ ] **Step 2: Remove the add/remove plant functions**

Delete `addPlant` (lines ~57-69) and `removePlant` (lines ~71-76).

- [ ] **Step 3: Rewrite the "Currently planted" section**

Replace the "Currently planted" heading, list, and add `<form>` (lines ~211-248) with:

```tsx
<h3 style={{ color: "#7a6a44", marginBottom: 4, marginTop: 16 }}>Currently planted</h3>
{planted.length === 0 && <p style={{ color: "#8a8268", margin: 0 }}>No plants listed yet.</p>}
<ul style={{ marginTop: 4 }}>
  {planted.map((p) => (
    <li key={p.id}>
      {p.common_name}
      {p.botanical_name ? <em style={{ color: "#8a8268" }}> — {p.botanical_name}</em> : null}
      {p.purchase_date ? <span style={{ color: "#8a8268" }}> · {p.purchase_date}</span> : null}
    </li>
  ))}
</ul>
```

(Plants now come from purchases; there is no per-plant remove here — lifecycle is managed by editing the purchase's status in the tracker. The "+ Add purchase" link at the bottom of the panel remains the intake.)

- [ ] **Step 4: Confirm no orphaned references**

Search the file for `plants`, `newPlant`, `addPlant`, `removePlant`, `busy` and confirm none remain except intended ones. `busy` was used only by the removed plant form, so remove it and any `disabled={busy}` it fed.

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (no unused variables, no missing references).

- [ ] **Step 5: Commit**

```bash
git add src/components/ZonePanel.tsx
git commit -m "feat: derive Currently planted from purchases; remove standalone add-plant UI"
```

---

### Task 7: Drop the `plants` table and remove the `Plant` type

**Files:**
- Create: `supabase/migrations/0004_drop_plants_table.sql`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no `plants` table; no `Plant` type. (Do this last so earlier tasks that still referenced `Plant` compiled.)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_drop_plants_table.sql`:

```sql
-- Purchases are the single intake for plants; a zone's "currently planted"
-- list is derived from purchases (status = 'planted'). The standalone plants
-- table is no longer used.
drop table if exists plants;
```

- [ ] **Step 2: Remove the `Plant` type**

In `src/lib/types.ts`, delete the entire `Plant` type (lines ~35-42).

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS — no remaining references to `Plant` (Tasks 4 and 6 removed them).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_drop_plants_table.sql src/lib/types.ts
git commit -m "feat: drop plants table and Plant type"
```

Note: applying the migration to the live DB (`node scripts/migrate.mjs 0004_drop_plants_table.sql`) is destructive and is run by the maintainer.

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `plant-catalog` tests.

- [ ] **Step 2: Typecheck and lint the whole project**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. In particular, no file still imports `Plant` or references `/api/plants`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (optional, needs env + applied migration)**

With `.env.local` set and migration `0004` applied: `npm run dev`, add a purchase using the catalog typeahead (pick a match; confirm botanical name auto-fills), save with `status = 'planted'` and a zone, then open that zone and confirm the plant appears under "Currently planted." Change the purchase's status to `died` in the tracker and confirm it disappears from "Currently planted" but remains in the tracker log. Add another purchase with a custom (off-catalog) name via the escape hatch and confirm it saves.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for purchase-driven plant intake"
```

(If nothing changed in Steps 1-3, skip this commit.)

---

## Self-Review Notes

- **Spec coverage:** catalog search endpoint + ranking/sanitizer (Tasks 1-2), catalog picker in PurchaseForm with escape hatch + `catalog_id` (Tasks 3-4), removal of mirror + `/api/plants` (Task 5), "Currently planted" derived from purchases `status='planted'` + removal of standalone add UI (Task 6), drop `plants` table + `Plant` type (Task 7), tests for `lib/` logic (Task 1). All spec sections map to a task.
- **Ordering:** the `Plant` type is removed only in Task 7, after Tasks 4 and 6 have removed all its consumers, so every intermediate task compiles.
- **Type consistency:** `CatalogResult` and the `PlantField` `onChange` shape (`{ common_name, botanical_name, catalog_id }`) are used consistently across Tasks 1-4; `Purchase` (already in types) backs the derived list in Task 6.
- **Out of scope confirmed:** no CSV import, no dedup logic, no new date column (purchase_date is the planting date).
