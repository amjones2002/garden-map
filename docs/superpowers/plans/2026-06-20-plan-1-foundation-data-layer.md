# Plan 1 — Foundation & Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js app shell (mobile-first, `/` + `/tracker` + nav) wired to Supabase, with the full database schema created and seeded (plant catalog from NPSOT + WildflowersOrg, zones with placeholder shapes, vendors), proven by tests.

**Architecture:** Next.js (App Router, TypeScript) on the front; Supabase Postgres behind it. Public reads use the `anon` key with RLS allowing `SELECT`; all writes (later plans) route through server code holding the `service_role` key. The plant catalog and zone/vendor seeds are produced by standalone Node scripts that parse the reference files already in the repo. Schema and seeds are applied to Supabase via the Supabase MCP.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, `@supabase/supabase-js` v2, Vitest + React Testing Library, `csv-parse` (sync) for the NPSOT CSV, `node-html-parser` for the WildflowersOrg tables.

## Global Constraints

- **Property:** 1105 Eastview Cir, Richardson, TX — Lot 27, Block P, 0.2962 acres (12,901 sq ft). Richardson straddles ecoregions **Texas Blackland Prairies** and **Cross Timbers**.
- **Mobile-first is a hard requirement.** Every view must work standing in the yard on a phone. Touch targets ≥ 44px.
- **Public read-only; gated edit.** Reads need no auth (RLS `SELECT` for `anon`). Writes are gated (Plan 2). The `service_role` key must NEVER reach the browser — server-only.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` and `EDIT_PASSWORD` live only in `.env.local` (gitignored). `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the only client-exposed Supabase values.
- **Supabase project ref:** `rdckuaoxcxfnpjpeussk`. Apply schema/seeds via the Supabase MCP.
- **`zones.shape`** is a normalized 0–1 coordinate array (`[{x,y},...]`), so polygons scale to any viewport.
- **`purchases.status`** ∈ `planted | pending | replaced | died` (CHECK constraint, not enum).
- **CSV parsing must use a real parser** — NPSOT quoted fields contain embedded newlines; line-splitting corrupts rows.
- **Use the NPSOT CSV, not the XLSX** (XLSX has a two-row category header).
- **TDD throughout. Commit after each passing step.**

**Reference files already in repo:**
- `NPSOT/plant-list.csv` — 25-column native plant catalog (primary source)
- `WildflowersOrg/*.htm` — 11 ecoregion list tables (Scientific Name | Common Name | Duration | Habit | Sun | Water)
- `survey-page-1.png` — rendered survey (used in later plans)
- `1105eastview_Survey - New.PDF` — vector plat survey

---

## File Structure

**Created in this plan:**
- `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs` — scaffold (from `create-next-app`)
- `src/app/layout.tsx` — root layout: mobile viewport, fonts, renders `<Nav>`
- `src/app/globals.css` — Tailwind import + base tokens (palette placeholders)
- `src/app/page.tsx` — Map view (placeholder content this plan; real map in Plan 3)
- `src/app/tracker/page.tsx` — Tracker view (placeholder content; real table in Plan 4)
- `src/components/Nav.tsx` — bottom tab nav (Map / Tracker), mobile-first
- `src/lib/supabase/client.ts` — browser Supabase client (anon key)
- `src/lib/supabase/server.ts` — server Supabase client (service-role key, server-only)
- `src/lib/types.ts` — shared TypeScript types for DB rows
- `supabase/migrations/0001_init.sql` — schema: tables, constraints, RLS
- `scripts/lib/parse-npsot.mjs` — pure parser: NPSOT CSV → catalog row objects
- `scripts/lib/parse-wildflower.mjs` — pure parser: one WildflowersOrg HTML → {scientific_name, ecoregion} rows
- `scripts/lib/merge-catalog.mjs` — pure: merge NPSOT rows + wildflower ecoregions → final catalog rows
- `scripts/seed-catalog.mjs` — runs the parsers, inserts into `plant_catalog` via service-role client
- `scripts/seed-zones.mjs` — inserts placeholder zones + vendors (incl. "Data Migration")
- `vitest.config.ts` — test config
- `tests/parse-npsot.test.ts`
- `tests/parse-wildflower.test.ts`
- `tests/merge-catalog.test.ts`
- `.env.example` — documents required env vars (no secrets)

**Modified:**
- `.gitignore` — add Next.js / env entries (most already present from spec commit)
- `README.md` — setup instructions

---

## Task 1: Scaffold the Next.js app

**Files:**
- Create: scaffold output (`package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: a runnable Next.js dev server on `http://localhost:3000`; `src/app/` App Router tree.

**Note on cwd:** all commands run from the repo root `C:\Users\amjon\OneDrive\claude\garden-map`. The repo already contains files (LICENSE, docs, data dirs), so scaffold into the current directory.

- [ ] **Step 1: Scaffold into the existing repo**

The repo is non-empty, so create the app in a temp dir and move files in, or use the current-directory flag. Run:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```

If it refuses due to existing files, scaffold into `tmp-app/` then move `src/`, config files, and merge `package.json` deps manually. Keep the existing `NPSOT/`, `WildflowersOrg/`, `docs/`, `survey-page-1.png`, `.mcp.json`, `LICENSE`.

- [ ] **Step 2: Verify dev server boots**

Run:
```bash
npm run dev
```
Expected: server starts, `http://localhost:3000` returns the Next.js starter page. Stop the server (Ctrl-C) after confirming.

- [ ] **Step 3: Set mobile viewport in the root layout**

In `src/app/layout.tsx`, export viewport so phones render at device width:

```tsx
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#3f4a2e",
};
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app (App Router, TS, Tailwind)"
```

---

## Task 2: Install data-layer dependencies and configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` runs Vitest; project deps `@supabase/supabase-js`, `csv-parse`, `node-html-parser`, `dotenv` available.

- [ ] **Step 1: Install dependencies**

```bash
npm install @supabase/supabase-js csv-parse node-html-parser dotenv
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 3: Add the test script to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a smoke test** in `tests/smoke.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test harness", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add Vitest + data-layer deps"
```

---

## Task 3: NPSOT CSV parser (pure function, TDD)

**Files:**
- Create: `scripts/lib/parse-npsot.mjs`
- Test: `tests/parse-npsot.test.ts`

**Interfaces:**
- Produces: `parseNpsot(csvText: string) => CatalogRow[]` where
  ```ts
  type CatalogRow = {
    scientific_name: string;
    common_name: string;
    other_common_names: string | null;
    growth_form: string | null;
    height_min: number | null;
    height_max: number | null;
    spread_min: number | null;
    spread_max: number | null;
    light: string | null;
    water: string | null;
    soil: string | null;
    bloom_season: string | null;
    bloom_color: string | null;
    wildlife_benefit: string | null;
    native_habitat: string | null;
    ecoregions: string[];      // empty here; filled by merge step
    is_tx_native: boolean;     // true for NPSOT rows
    source: string;            // 'npsot.org'
    source_url: string | null; // from "Plant URL"
  };
  ```
  Consumed by `scripts/lib/merge-catalog.mjs` and `scripts/seed-catalog.mjs`.

- [ ] **Step 1: Write the failing test** in `tests/parse-npsot.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseNpsot } from "../scripts/lib/parse-npsot.mjs";

const SAMPLE = `"Scientific Name","Common Name","Plant URL","Other Common Names","Other Scientific Names","Growth Form","Ecoregion III","Ecoregion IV","Min Height","Max Height","Min Spread","Max Spread","Leaf Retention","Lifespan","Soil","Light","Water","Native Habitat","Bloom Season","Bloom Color","Seasonal Interest","Wildlife Benefit","Maintenence","Comments","References"
"Abronia ameliae","Heart's Delight","https://www.npsot.org/posts/native-plant/abronia-ameliae/","Amelia's Sand-verbena","","Herbaceous","Gulf Coast Prairies and Marshes","Coastal Sand Plain","1","1.5","0.5","1","Deciduous","Perennial","Sand","Sun, Part Shade","Low, Medium","Grassland","Spring","Pink, Purple","Nectar","Butterflies","A note.","A
multi-line comment with an embedded newline.","ref1"`;

describe("parseNpsot", () => {
  it("parses one data row with the right fields", () => {
    const rows = parseNpsot(SAMPLE);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.scientific_name).toBe("Abronia ameliae");
    expect(r.common_name).toBe("Heart's Delight");
    expect(r.source).toBe("npsot.org");
    expect(r.source_url).toBe("https://www.npsot.org/posts/native-plant/abronia-ameliae/");
    expect(r.is_tx_native).toBe(true);
    expect(r.light).toBe("Sun, Part Shade");
    expect(r.water).toBe("Low, Medium");
    expect(r.height_min).toBe(1);
    expect(r.height_max).toBe(1.5);
    expect(r.ecoregions).toEqual([]);
  });

  it("handles embedded newlines inside quoted fields without splitting rows", () => {
    const rows = parseNpsot(SAMPLE);
    expect(rows).toHaveLength(1); // not 2 — the newline is inside a quoted field
  });

  it("coerces blank numerics to null", () => {
    const blank = SAMPLE.replace('"1","1.5","0.5","1"', '"","","",""');
    const rows = parseNpsot(blank);
    expect(rows[0].height_min).toBeNull();
    expect(rows[0].height_max).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/parse-npsot.test.ts`
Expected: FAIL — cannot find module `parse-npsot.mjs`.

- [ ] **Step 3: Implement `scripts/lib/parse-npsot.mjs`**

```js
import { parse } from "csv-parse/sync";

const numOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const strOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

export function parseNpsot(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  return records.map((row) => ({
    scientific_name: (row["Scientific Name"] || "").trim(),
    common_name: (row["Common Name"] || "").trim(),
    other_common_names: strOrNull(row["Other Common Names"]),
    growth_form: strOrNull(row["Growth Form"]),
    height_min: numOrNull(row["Min Height"]),
    height_max: numOrNull(row["Max Height"]),
    spread_min: numOrNull(row["Min Spread"]),
    spread_max: numOrNull(row["Max Spread"]),
    light: strOrNull(row["Light"]),
    water: strOrNull(row["Water"]),
    soil: strOrNull(row["Soil"]),
    bloom_season: strOrNull(row["Bloom Season"]),
    bloom_color: strOrNull(row["Bloom Color"]),
    wildlife_benefit: strOrNull(row["Wildlife Benefit"]),
    native_habitat: strOrNull(row["Native Habitat"]),
    ecoregions: [],
    is_tx_native: true,
    source: "npsot.org",
    source_url: strOrNull(row["Plant URL"]),
  })).filter((r) => r.scientific_name !== "");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/parse-npsot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run against the real file as a sanity check**

```bash
node -e "import('./scripts/lib/parse-npsot.mjs').then(async m => { const fs=await import('fs'); const t=fs.readFileSync('NPSOT/plant-list.csv','utf8'); const rows=m.parseNpsot(t); console.log('rows:', rows.length); console.log(rows[0]); })"
```
Expected: prints a plausible row count (hundreds–thousands) and a well-formed first row. (Informational; do not assert an exact count.)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/parse-npsot.mjs tests/parse-npsot.test.ts
git commit -m "feat: NPSOT CSV parser with multiline-safe parsing"
```

---

## Task 4: WildflowersOrg HTML parser (pure function, TDD)

**Files:**
- Create: `scripts/lib/parse-wildflower.mjs`
- Test: `tests/parse-wildflower.test.ts`

**Interfaces:**
- Produces: `parseWildflower(html: string, ecoregion: string) => { scientific_name: string; common_name: string; ecoregion: string }[]`. Consumed by `merge-catalog.mjs`.
- The table layout is: row 1 = ecoregion description (single cell), row 2 = header (`Scientific Name | Common Name | Duration | Habit | Sun | Water`), rows 3+ = data.

- [ ] **Step 1: Write the failing test** in `tests/parse-wildflower.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseWildflower } from "../scripts/lib/parse-wildflower.mjs";

const HTML = `
<table>
  <tr><td>Cross Timbers description spanning one cell.</td></tr>
  <tr><td>Scientific Name</td><td>Common Name</td><td>Duration</td><td>Habit</td><td>Sun</td><td>Water</td></tr>
  <tr><td>Abutilon fruticosum</td><td>Texas Indian Mallow</td><td>Perennial</td><td>Herb</td><td>Sun</td><td>Dry</td></tr>
  <tr><td>Acacia angustissima</td><td>Prairie Acacia</td><td>Perennial</td><td>Shrub</td><td>Sun</td><td>Dry</td></tr>
</table>`;

describe("parseWildflower", () => {
  it("extracts data rows tagged with the ecoregion", () => {
    const rows = parseWildflower(HTML, "Cross Timbers");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      scientific_name: "Abutilon fruticosum",
      common_name: "Texas Indian Mallow",
      ecoregion: "Cross Timbers",
    });
  });

  it("skips the description row and the header row", () => {
    const rows = parseWildflower(HTML, "Cross Timbers");
    const names = rows.map((r) => r.scientific_name);
    expect(names).not.toContain("Scientific Name");
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/parse-wildflower.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/parse-wildflower.mjs`**

```js
import { parse } from "node-html-parser";

export function parseWildflower(html, ecoregion) {
  const root = parse(html);
  const rows = root.querySelectorAll("tr");
  const out = [];
  for (const tr of rows) {
    const cells = tr.querySelectorAll("td, th").map((c) =>
      c.text.replace(/\s+/g, " ").trim()
    );
    if (cells.length < 6) continue;                 // skip description row
    if (cells[0].toLowerCase() === "scientific name") continue; // skip header
    const scientific_name = cells[0];
    const common_name = cells[1];
    if (!scientific_name) continue;
    out.push({ scientific_name, common_name, ecoregion });
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/parse-wildflower.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Sanity-check against a real file**

```bash
node -e "import('./scripts/lib/parse-wildflower.mjs').then(async m => { const fs=await import('fs'); const t=fs.readFileSync('WildflowersOrg/Cross Timbers.htm','utf8'); const rows=m.parseWildflower(t,'Cross Timbers'); console.log('rows:', rows.length); console.log(rows.slice(0,2)); })"
```
Expected: a few hundred rows, clean first entries.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/parse-wildflower.mjs tests/parse-wildflower.test.ts
git commit -m "feat: WildflowersOrg ecoregion table parser"
```

---

## Task 5: Catalog merge (pure function, TDD)

**Files:**
- Create: `scripts/lib/merge-catalog.mjs`
- Test: `tests/merge-catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogRow[]` from `parseNpsot`; `{scientific_name, ecoregion}[]` from `parseWildflower`.
- Produces: `mergeCatalog(npsotRows, wildflowerRows) => CatalogRow[]` — same NPSOT rows with `ecoregions` populated (deduped, sorted) by case-insensitive scientific-name match. Wildflower-only species are NOT added (NPSOT is the catalog spine). Consumed by `scripts/seed-catalog.mjs`.

- [ ] **Step 1: Write the failing test** in `tests/merge-catalog.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mergeCatalog } from "../scripts/lib/merge-catalog.mjs";

const npsot = [
  { scientific_name: "Acacia angustissima", common_name: "Prairie Acacia", ecoregions: [], source: "npsot.org" },
  { scientific_name: "Abronia ameliae", common_name: "Heart's Delight", ecoregions: [], source: "npsot.org" },
];
const wild = [
  { scientific_name: "Acacia angustissima", common_name: "Prairie Acacia", ecoregion: "Cross Timbers" },
  { scientific_name: "acacia angustissima", common_name: "Prairie Acacia", ecoregion: "Texas Blackland Prairies" },
  { scientific_name: "Acacia angustissima", common_name: "Prairie Acacia", ecoregion: "Cross Timbers" }, // dup
  { scientific_name: "Some other sp.", common_name: "X", ecoregion: "High Plains" },
];

describe("mergeCatalog", () => {
  it("attaches deduped, sorted ecoregions by case-insensitive name match", () => {
    const out = mergeCatalog(npsot, wild);
    const acacia = out.find((r) => r.scientific_name === "Acacia angustissima");
    expect(acacia.ecoregions).toEqual(["Cross Timbers", "Texas Blackland Prairies"]);
  });

  it("leaves unmatched NPSOT rows with empty ecoregions", () => {
    const out = mergeCatalog(npsot, wild);
    const abronia = out.find((r) => r.scientific_name === "Abronia ameliae");
    expect(abronia.ecoregions).toEqual([]);
  });

  it("does not add wildflower-only species to the catalog", () => {
    const out = mergeCatalog(npsot, wild);
    expect(out.find((r) => r.scientific_name === "Some other sp.")).toBeUndefined();
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/merge-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/merge-catalog.mjs`**

```js
export function mergeCatalog(npsotRows, wildflowerRows) {
  const byName = new Map();
  for (const w of wildflowerRows) {
    const key = w.scientific_name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(w.ecoregion);
  }
  return npsotRows.map((r) => {
    const key = r.scientific_name.toLowerCase().trim();
    const regions = byName.get(key);
    return {
      ...r,
      ecoregions: regions ? [...regions].sort() : [],
    };
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/merge-catalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/merge-catalog.mjs tests/merge-catalog.test.ts
git commit -m "feat: merge NPSOT catalog with WildflowersOrg ecoregions"
```

---

## Task 6: Database schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Interfaces:**
- Produces: tables `zones`, `plants`, `purchases`, `vendors`, `zone_photos`, `plant_catalog` with constraints + RLS. Consumed by every later task and plan.
- Applied via Supabase MCP (`apply_migration`) against project `rdckuaoxcxfnpjpeussk`. If the MCP is unavailable, paste the SQL into the Supabase SQL Editor.

- [ ] **Step 1: Write `supabase/migrations/0001_init.sql`**

```sql
-- Extensions
create extension if not exists "pgcrypto";

-- VENDORS
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  url text,
  notes text,
  sort_order int not null default 0
);

-- ZONES
create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  label text,
  description text,
  shape jsonb not null default '[]'::jsonb,   -- [{x,y},...] normalized 0..1
  fill_color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- PLANT CATALOG
create table if not exists plant_catalog (
  id uuid primary key default gen_random_uuid(),
  scientific_name text not null,
  common_name text,
  other_common_names text,
  growth_form text,
  height_min numeric,
  height_max numeric,
  spread_min numeric,
  spread_max numeric,
  light text,
  water text,
  soil text,
  bloom_season text,
  bloom_color text,
  wildlife_benefit text,
  native_habitat text,
  ecoregions text[] not null default '{}',
  is_tx_native boolean not null default true,
  source text not null,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists plant_catalog_common_name_idx on plant_catalog (lower(common_name));
create index if not exists plant_catalog_scientific_name_idx on plant_catalog (lower(scientific_name));

-- PLANTS (curated "currently planted here" list)
create table if not exists plants (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones(id) on delete cascade,
  common_name text not null,
  botanical_name text,
  catalog_id uuid references plant_catalog(id) on delete set null,
  sort_order int not null default 0
);

-- PURCHASES (the tracker log)
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references zones(id) on delete set null,
  common_name text not null,
  botanical_name text,
  catalog_id uuid references plant_catalog(id) on delete set null,
  vendor_id uuid references vendors(id) on delete set null,
  purchase_date date,
  price numeric,
  price_estimated boolean not null default false,
  quantity int not null default 1,
  status text not null default 'planted'
    check (status in ('planted','pending','replaced','died')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_zone_idx on purchases (zone_id);
create index if not exists purchases_status_idx on purchases (status);

-- ZONE PHOTOS
create table if not exists zone_photos (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones(id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  uploaded_at timestamptz not null default now(),
  sort_order int not null default 0
);

-- ROW LEVEL SECURITY: public read, no public write.
-- Writes are performed by the service_role key (which bypasses RLS) via server code.
alter table vendors        enable row level security;
alter table zones          enable row level security;
alter table plant_catalog  enable row level security;
alter table plants         enable row level security;
alter table purchases      enable row level security;
alter table zone_photos    enable row level security;

-- Public SELECT policies (role: anon and authenticated)
create policy "public read vendors"        on vendors       for select using (true);
create policy "public read zones"          on zones         for select using (true);
create policy "public read plant_catalog"  on plant_catalog for select using (true);
create policy "public read plants"         on plants        for select using (true);
create policy "public read purchases"      on purchases     for select using (true);
create policy "public read zone_photos"    on zone_photos   for select using (true);
-- No INSERT/UPDATE/DELETE policies => anon cannot write. service_role bypasses RLS.
```

- [ ] **Step 2: Apply the migration to Supabase**

Via the Supabase MCP, apply `supabase/migrations/0001_init.sql` (tool: `apply_migration`, name `init`). Fallback: paste the SQL into the Supabase SQL Editor and run.

- [ ] **Step 3: Verify tables exist**

Via the Supabase MCP, list tables (tool: `list_tables`) and confirm all six exist with RLS enabled. Fallback query in SQL Editor:
```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```
Expected: `plant_catalog, plants, purchases, vendors, zone_photos, zones`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: initial database schema with RLS public-read policies"
```

---

## Task 7: Supabase client modules + shared types

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/types.ts`, `.env.example`
- Modify: `.env.local` (NOT committed — create locally with real values)

**Interfaces:**
- Produces:
  - `getBrowserSupabase(): SupabaseClient` (anon key) — for client components reading data.
  - `getServerSupabase(): SupabaseClient` (service-role key) — server-only; used by API routes in later plans.
  - Types `Zone`, `Plant`, `Purchase`, `Vendor`, `ZonePhoto`, `PlantCatalog` in `src/lib/types.ts`.

- [ ] **Step 1: Create `.env.example`**

```bash
# Public (safe to expose to the browser)
NEXT_PUBLIC_SUPABASE_URL=https://rdckuaoxcxfnpjpeussk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only secrets (never exposed to the browser)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
EDIT_PASSWORD=choose-a-shared-edit-password
```

- [ ] **Step 2: Create your real `.env.local`**

Copy `.env.example` to `.env.local` and fill in the real `anon` key, `service_role` key (from Supabase → Settings → API), and an `EDIT_PASSWORD` of your choosing. Confirm `.env.local` is gitignored:
```bash
git check-ignore .env.local
```
Expected: prints `.env.local` (meaning it is ignored).

- [ ] **Step 3: Create `src/lib/types.ts`**

```ts
export type Zone = {
  id: string;
  slug: string;
  name: string;
  label: string | null;
  description: string | null;
  shape: { x: number; y: number }[];
  fill_color: string | null;
  sort_order: number;
  created_at: string;
};

export type Vendor = {
  id: string;
  name: string;
  url: string | null;
  notes: string | null;
  sort_order: number;
};

export type Plant = {
  id: string;
  zone_id: string;
  common_name: string;
  botanical_name: string | null;
  catalog_id: string | null;
  sort_order: number;
};

export type PurchaseStatus = "planted" | "pending" | "replaced" | "died";

export type Purchase = {
  id: string;
  zone_id: string | null;
  common_name: string;
  botanical_name: string | null;
  catalog_id: string | null;
  vendor_id: string | null;
  purchase_date: string | null;
  price: number | null;
  price_estimated: boolean;
  quantity: number;
  status: PurchaseStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ZonePhoto = {
  id: string;
  zone_id: string;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  uploaded_at: string;
  sort_order: number;
};

export type PlantCatalog = {
  id: string;
  scientific_name: string;
  common_name: string | null;
  other_common_names: string | null;
  growth_form: string | null;
  height_min: number | null;
  height_max: number | null;
  spread_min: number | null;
  spread_max: number | null;
  light: string | null;
  water: string | null;
  soil: string | null;
  bloom_season: string | null;
  bloom_color: string | null;
  wildlife_benefit: string | null;
  native_habitat: string | null;
  ecoregions: string[];
  is_tx_native: boolean;
  source: string;
  source_url: string | null;
  created_at: string;
};
```

- [ ] **Step 4: Create `src/lib/supabase/client.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  browserClient = createClient(url, anon, { auth: { persistSession: false } });
  return browserClient;
}
```

- [ ] **Step 5: Create `src/lib/supabase/server.ts`**

```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. NEVER import this into a client component.
export function getServerSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
```

Install the guard package:
```bash
npm install server-only
```

- [ ] **Step 6: Commit**

```bash
git add src/lib .env.example package.json package-lock.json
git commit -m "feat: Supabase client modules and shared DB types"
```

---

## Task 8: Catalog seed script

**Files:**
- Create: `scripts/seed-catalog.mjs`

**Interfaces:**
- Consumes: `parseNpsot`, `parseWildflower`, `mergeCatalog`; env from `.env.local`.
- Produces: rows inserted into `plant_catalog`. Idempotent: clears `plant_catalog` first, then inserts (so re-running is safe before any `plants`/`purchases` reference catalog rows).

- [ ] **Step 1: Write `scripts/seed-catalog.mjs`**

```js
import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseNpsot } from "./lib/parse-npsot.mjs";
import { parseWildflower } from "./lib/parse-wildflower.mjs";
import { mergeCatalog } from "./lib/merge-catalog.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Map filename (without extension) -> ecoregion label.
const ECOREGION_FILES = {
  "Arizona and New Mexico Mountains": "Arizona and New Mexico Mountains",
  "Central Great Plains": "Central Great Plains",
  "Chihuahuan Desert": "Chihuahuan Desert",
  "Cross Timbers": "Cross Timbers",
  "East Central Texas Plains": "East Central Texas Plains",
  "Edwards Plateau": "Edwards Plateau",
  "High Plains": "High Plains",
  "SouthCentralPlains": "South Central Plains",
  "Southern Texas Plains": "Southern Texas Plains",
  "Southwestern Tablelands": "Southwestern Tablelands",
  "Texas Blackland Prairies": "Texas Blackland Prairies",
  "Western Gulf Coastal Plain": "Western Gulf Coastal Plain",
};

async function main() {
  const npsotText = fs.readFileSync("NPSOT/plant-list.csv", "utf8");
  const npsotRows = parseNpsot(npsotText);
  console.log("NPSOT rows:", npsotRows.length);

  const wildDir = "WildflowersOrg";
  let wildRows = [];
  for (const file of fs.readdirSync(wildDir)) {
    if (!file.endsWith(".htm")) continue;
    const base = path.basename(file, ".htm");
    const ecoregion = ECOREGION_FILES[base] || base;
    const html = fs.readFileSync(path.join(wildDir, file), "utf8");
    wildRows = wildRows.concat(parseWildflower(html, ecoregion));
  }
  console.log("Wildflower rows:", wildRows.length);

  const merged = mergeCatalog(npsotRows, wildRows);
  console.log("Merged catalog rows:", merged.length);

  // Idempotent reset
  const { error: delErr } = await supabase
    .from("plant_catalog")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) throw delErr;

  // Insert in batches of 500
  for (let i = 0; i < merged.length; i += 500) {
    const batch = merged.slice(i, i + 500);
    const { error } = await supabase.from("plant_catalog").insert(batch);
    if (error) throw error;
    console.log(`inserted ${Math.min(i + 500, merged.length)}/${merged.length}`);
  }
  console.log("Catalog seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add a seed script alias to `package.json`**

In `"scripts"`:
```json
"seed:catalog": "node scripts/seed-catalog.mjs"
```

- [ ] **Step 3: Run the seed (requires `.env.local` + applied schema + Supabase reachable)**

Run: `npm run seed:catalog`
Expected: logs row counts and "Catalog seed complete." with no errors.

- [ ] **Step 4: Verify row count in Supabase**

Via Supabase MCP (`execute_sql`) or SQL Editor:
```sql
select count(*) from plant_catalog;
select count(*) from plant_catalog where array_length(ecoregions,1) > 0;
```
Expected: catalog count matches the merged total; a substantial subset has ecoregions.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-catalog.mjs package.json
git commit -m "feat: seed plant_catalog from NPSOT + WildflowersOrg"
```

---

## Task 9: Zones + vendors seed script

**Files:**
- Create: `scripts/seed-zones.mjs`

**Interfaces:**
- Produces: 8 placeholder zones (from spec §7.2) with simple placeholder rectangle shapes and palette colors, and the vendor list including "Data Migration". Idempotent via upsert on unique keys (`zones.slug`, `vendors.name`).
- "Triangle" and "The Field" are intentionally omitted — added later once the user points out their locations (spec §9).

- [ ] **Step 1: Write `scripts/seed-zones.mjs`**

```js
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Placeholder rectangles in normalized 0..1 coords; refined later in the shape editor.
const rect = (x, y, w, h) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const ZONES = [
  { slug: "hellstrip",       name: "Hellstrip",            label: "Hellstrip",       fill_color: "#9bbf4a", sort_order: 1, shape: rect(0.05, 0.70, 0.25, 0.18), description: "Curved corner bed at Eastview Cir / Baltimore: frog fruit, bluebonnets, black-eyed Susans, echinacea." },
  { slug: "foundation-bed",  name: "Foundation Bed",       label: "Foundation Bed",  fill_color: "#7aa329", sort_order: 2, shape: rect(0.30, 0.40, 0.35, 0.10), description: "~50 ft bed along the house: Taylor Junipers, Canyon Creek & Kaleidoscope Abelias, liriope/dwarf mondo, asparagus." },
  { slug: "cedar-planters",  name: "Cedar Planters",       label: "Cedar Planters",  fill_color: "#b5651d", sort_order: 3, shape: rect(0.62, 0.30, 0.12, 0.10), description: "Two raised beds on the covered pool patio: herbs and ornamentals." },
  { slug: "pool-spa",        name: "Pool & Spa",           label: "Pool",            fill_color: "#4aa3bf", sort_order: 4, shape: rect(0.70, 0.42, 0.16, 0.16), description: "Pool and spa." },
  { slug: "dry-mineral-bed", name: "Dry Mineral Bed",      label: "Dry Mineral Bed", fill_color: "#c9a14a", sort_order: 5, shape: rect(0.55, 0.60, 0.18, 0.12), description: "Sotol, Penstemon baccharifolius, Asclepias tuberosa." },
  { slug: "front-raised-bed",name: "Front Raised Bed (8x3)",label: "Raised Bed",     fill_color: "#8e3b5e", sort_order: 6, shape: rect(0.32, 0.55, 0.12, 0.07), description: "8x3 raised bed: giant coneflowers, Turk's cap, homestead verbena." },
  { slug: "north-side-yard", name: "North Side Yard",      label: "North Side",      fill_color: "#6fae3f", sort_order: 7, shape: rect(0.32, 0.20, 0.30, 0.10), description: "Summer annuals, catmint, dwarf sunflowers." },
  { slug: "stock-tank",      name: "Stock Tank Fountain",  label: "Stock Tank",      fill_color: "#5e8c6a", sort_order: 8, shape: rect(0.20, 0.50, 0.08, 0.08), description: "Stock tank fountain: milkweed and monarch habitat." },
];

const VENDORS = [
  { name: "Data Migration", notes: "Placeholder vendor for imported records with unknown source.", sort_order: 99 },
];

async function main() {
  const { error: zErr } = await supabase
    .from("zones")
    .upsert(ZONES, { onConflict: "slug" });
  if (zErr) throw zErr;
  console.log(`Upserted ${ZONES.length} zones.`);

  const { error: vErr } = await supabase
    .from("vendors")
    .upsert(VENDORS, { onConflict: "name" });
  if (vErr) throw vErr;
  console.log(`Upserted ${VENDORS.length} vendors.`);
  console.log("Zone/vendor seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the seed alias to `package.json`**

In `"scripts"`:
```json
"seed:zones": "node scripts/seed-zones.mjs"
```

- [ ] **Step 3: Run it**

Run: `npm run seed:zones`
Expected: "Upserted 8 zones." / "Upserted 1 vendors." / "Zone/vendor seed complete."

- [ ] **Step 4: Verify**

Via Supabase MCP (`execute_sql`) or SQL Editor:
```sql
select slug, name, jsonb_array_length(shape) as points from zones order by sort_order;
select name from vendors;
```
Expected: 8 zones each with 4 shape points; vendor "Data Migration".

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-zones.mjs package.json
git commit -m "feat: seed placeholder zones and Data Migration vendor"
```

---

## Task 10: App shell — nav + two views reading live data

**Files:**
- Create: `src/components/Nav.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/tracker/page.tsx`, `src/app/globals.css`
- Test: `tests/nav.test.tsx`

**Interfaces:**
- Consumes: `getBrowserSupabase()`, types from `src/lib/types.ts`.
- Produces: a working two-tab mobile shell. `/` lists zone names from the DB (placeholder for the real map). `/tracker` shows a purchase count (placeholder for the real table). Confirms the public read path works end-to-end.

- [ ] **Step 1: Write the failing test** in `tests/nav.test.tsx`

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Nav from "../src/components/Nav";

describe("Nav", () => {
  it("renders Map and Tracker links", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: /map/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /tracker/i })).toBeDefined();
  });
});
```

Add to `tests` setup so `@testing-library/jest-dom` matchers exist — create `tests/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```
And reference it in `vitest.config.ts` by adding `setupFiles: ["tests/setup.ts"]` to the `test` block.

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/nav.test.tsx`
Expected: FAIL — cannot find `Nav`.

- [ ] **Step 3: Implement `src/components/Nav.tsx`**

```tsx
import Link from "next/link";

export default function Nav() {
  return (
    <nav
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        display: "flex", borderTop: "1px solid #cbb994",
        background: "#f5efe0", zIndex: 50,
      }}
    >
      <Link href="/" style={{ flex: 1, textAlign: "center", padding: "14px 0", minHeight: 44 }}>
        Map
      </Link>
      <Link href="/tracker" style={{ flex: 1, textAlign: "center", padding: "14px 0", minHeight: 44 }}>
        Tracker
      </Link>
    </nav>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `Nav` into the layout**

In `src/app/layout.tsx`, render `<Nav />` after `{children}` and add bottom padding so content clears the fixed nav:
```tsx
import Nav from "@/components/Nav";
// ...
<body>
  <main style={{ paddingBottom: 64 }}>{children}</main>
  <Nav />
</body>
```

- [ ] **Step 6: Make `/` read zones (client component)**

Replace `src/app/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Zone } from "@/lib/types";

export default function MapPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .from("zones")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setZones((data ?? []) as Zone[]);
      });
  }, []);

  return (
    <section style={{ padding: 16 }}>
      <h1>Yard Map (placeholder)</h1>
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      <ul>
        {zones.map((z) => (
          <li key={z.id}>{z.name}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 7: Make `/tracker` read a purchase count**

Replace `src/app/tracker/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function TrackerPage() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    getBrowserSupabase()
      .from("purchases")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => setCount(count ?? 0));
  }, []);
  return (
    <section style={{ padding: 16 }}>
      <h1>Purchase Tracker (placeholder)</h1>
      <p>{count === null ? "Loading…" : `${count} purchases logged`}</p>
    </section>
  );
}
```

- [ ] **Step 8: Manually verify in the browser**

Run `npm run dev`, open `http://localhost:3000` on a narrow viewport (DevTools device mode). Expected: Map page lists the 8 seeded zone names; bottom nav switches to Tracker showing "0 purchases logged". No console errors about missing env vars.

- [ ] **Step 9: Run full test suite**

Run: `npm test`
Expected: all tests pass (smoke, parsers, merge, nav).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: mobile app shell with live zone + purchase reads"
```

---

## Task 11: README setup docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write setup instructions** into `README.md`

```markdown
# garden-map

Interactive yard map & plant purchase tracker for 1105 Eastview Cir, Richardson, TX.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in Supabase keys + `EDIT_PASSWORD`.
3. Apply the schema: `supabase/migrations/0001_init.sql` (via Supabase MCP or SQL Editor).
4. Seed data:
   - `npm run seed:catalog` — plant catalog from NPSOT + WildflowersOrg
   - `npm run seed:zones` — placeholder zones + vendors
5. `npm run dev` → http://localhost:3000

## Tests

`npm test`

## Stack

Next.js (App Router) · Supabase (Postgres + Storage) · Vercel. See `docs/superpowers/specs/` and `docs/superpowers/plans/`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: setup instructions"
```

---

## Self-Review

**Spec coverage (Plan 1 portion of spec §8 Phase 1–2 data layer):**
- ✅ Next.js scaffold + two views + nav (Task 1, 10)
- ✅ Supabase schema for all six tables incl. timestamps/price_estimated (Task 6)
- ✅ RLS public-read, write-gated by service role (Task 6)
- ✅ Catalog seed from NPSOT CSV (multiline-safe) + WildflowersOrg ecoregions (Tasks 3–5, 8)
- ✅ NPSOT CSV (not XLSX) per constraint (Task 3)
- ✅ Placeholder zones incl. all 8 named zones, Triangle/The Field intentionally deferred (Task 9)
- ✅ "Data Migration" vendor seeded (Task 9)
- ✅ Service-role key server-only; anon key client (Task 7)
- ✅ Mobile-first shell, 44px touch targets (Task 10)
- Deferred to later plans (correctly out of scope here): base-map SVG (Plan 3), zone panel (Plan 3), tracker CRUD/import/export (Plan 4), edit gate (Plan 2), shape editor (Plan 5), styling/deploy (Plan 6), zone photos storage bucket (Plan 3, when the panel needs it).

**Placeholder scan:** No TBD/TODO; every code step shows real code; every command has expected output.

**Type consistency:** `Zone.shape` is `{x,y}[]` in `types.ts` (Task 7), matches `jsonb [{x,y}]` in schema (Task 6) and `rect()` output (Task 9). `parseNpsot` `CatalogRow` shape (Task 3) matches `plant_catalog` columns (Task 6) and the insert in `seed-catalog.mjs` (Task 8). `mergeCatalog` preserves NPSOT fields + sets `ecoregions` (Task 5), consumed unchanged by the seed insert (Task 8).

**Note for executor:** Tasks 6, 8, 9 require the Supabase MCP authenticated (or SQL-Editor fallback) and `.env.local` populated. Tasks 1–5, 7, 11 need neither and can run offline.
