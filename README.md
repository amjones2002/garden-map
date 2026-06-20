# garden-map

Interactive yard map & plant purchase tracker for 1105 Eastview Cir, Richardson, TX
(Lot 27, Block P — a corner lot, 0.2962 acres). A public, mobile-first map of the
property's planting zones plus a tracker for plant purchases — a taste of the Texas
prairie and desert, shareable with anyone.

## Stack

Next.js 16 (App Router, TypeScript) · Supabase (Postgres + Storage) · Vercel.
Public read-only; editing is gated (shared password in v1, Google SSO planned for v2).

See `docs/superpowers/specs/` for the design spec and `docs/superpowers/plans/` for the
implementation plans.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon/public key (safe for the browser)
   - `SUPABASE_SERVICE_ROLE_KEY` — service-role key (server-only secret; never exposed)
   - `EDIT_PASSWORD` — shared password for edit mode

   Keys live in Supabase → **Project Settings → API**.

3. **Apply the database schema** — run `supabase/migrations/0001_init.sql` against the
   project, either via the Supabase **SQL Editor** (paste & run) or the Supabase MCP.

4. **Seed data**
   ```bash
   npm run seed:catalog   # plant_catalog from NPSOT + WildflowersOrg (~836 natives)
   npm run seed:zones     # 8 placeholder zones + the "Data Migration" vendor
   ```

5. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

## Tests

```bash
npm test
```

Vitest + React Testing Library. Pure data-layer logic (CSV/HTML parsing, catalog merge)
is covered by unit tests; the app shell has a component test.

## Project layout

| Path | Purpose |
|------|---------|
| `src/app/` | App Router pages: `/` (map), `/tracker` |
| `src/components/` | Shared UI (e.g. `Nav`) |
| `src/lib/supabase/` | Browser (anon) and server (service-role) Supabase clients |
| `src/lib/types.ts` | Shared DB row types |
| `scripts/` | Standalone seed + asset scripts (run with `node`) |
| `supabase/migrations/` | SQL schema |
| `NPSOT/`, `WildflowersOrg/` | Source data for the plant catalog |
| `survey-page-1.png` | Rendered plat survey (base-map trace + shape-editor background) |

## Data sources

- **NPSOT** native plant table (sanctioned CSV export) — primary catalog.
- **WildflowersOrg** ecoregion lists — ecoregion tagging (Richardson straddles
  Texas Blackland Prairies and Cross Timbers).
