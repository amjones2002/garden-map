# Backlog / Handoff

> **For a fresh session:** read this file plus `docs/superpowers/specs/` (design) and
> `docs/superpowers/plans/2026-06-20-plan-overview.md` (what's built) to get full context.
> The app is **live** at https://texas-garden-map.vercel.app and stable on `main`.

_Last updated: 2026-06-21._

## Orientation (read first)

- **Stack:** Next.js 16 (App Router, TS) · React 19 · Supabase (Postgres + Storage) · Vercel. Tailwind v4 for layout; the look is custom CSS (`src/app/globals.css`) — aged-paper / wood-element / BHL botanical, hand-lettered via the Caveat font.
- **Auth model:** public read-only; editing gated by a shared password. `EDIT_PASSWORD` → signed HMAC cookie (`src/lib/auth-core.ts` + `auth.ts`), checked by `requireEdit()` (`src/lib/require-edit.ts`). All writes go through gated `src/app/api/*` route handlers using the **service-role** Supabase client (`src/lib/supabase/server.ts`, server-only). Browser reads use the anon client (`src/lib/supabase/client.ts`) under public-read RLS.
- **Map:** one SVG coordinate space, normalized 0–1 (×1000 in the viewBox). `BaseMap.tsx` (survey-traced hardscape) + `ZoneShapes.tsx` (zones from `zones.shape`) + `MapLabels.tsx` (free text). Editors share the same `BaseMap`: `ShapeEditor.tsx` (`/editor`) and `LabelEditor.tsx` (`/editor/labels`).
- **Migrations:** `supabase/migrations/*.sql`. Applied via the Supabase SQL Editor (paste & run). A `pg` runner exists (`scripts/migrate.mjs`) that runs them autonomously **if** `SUPABASE_DB_URL` (direct connection URI) is set in `.env.local` — the slot is there, currently a placeholder.
- **Workflow:** every change = branch → PR → merge (gh CLI at `C:\Program Files\GitHub CLI\gh.exe`). Verify before merge: `npm test`, `npm run build`, and a live check (preview tool, or rasterize SVG with `sharp` since the preview screenshot can hang on the map page). Pushing `main` auto-deploys to Vercel.

---

## Backlog items

### 1. Headless UI primitives + design tokens (highest-value cleanup)
**Why:** the UI leans heavily on inline `style={{}}` objects — repeated literals, no theming layer, and the slide-up panel/modal is hand-rolled so accessibility (focus trap, Escape-to-close, keyboard nav) is incomplete.
**Do:**
- Add **Radix UI** primitives (or shadcn/ui = Radix + Tailwind) for Dialog (zone panel / confirms), Select, and Popover. Headless, so they keep the custom botanical look.
- Extract a small **design-tokens / styles module** (palette, spacing, the repeated `ctrl`/`field` button/input styles) so components stop redefining inline styles.
- Don't change the visual design; this is structure + a11y only.
**Touches:** `ZonePanel.tsx`, `PurchaseForm.tsx`, `TrackerTable.tsx`, `ShapeEditor.tsx`, `LabelEditor.tsx`, `EditToggle.tsx`; new `src/lib/ui/` styles module.
**Done when:** modals are keyboard/Escape accessible with focus trapping; inline-style duplication is largely gone; look is unchanged; tests + build green.

### 2. Photo capture-date (EXIF) + "through the seasons" timeline
**Why:** photos currently use the file's `lastModified` as `taken_at`. The `zone_photos.taken_at` column + chronological gallery already exist (`src/lib/photos.ts`, `ZonePanel.tsx`).
**Do:**
- Read EXIF `DateTimeOriginal` on upload (e.g. `exifr`) and prefer it over `lastModified`; let the user override with a date field.
- Build a scrubbable per-zone (and eventually whole-yard) timeline view ordered by `taken_at`.
**Touches:** `src/app/api/zone-photos/route.ts` (parse EXIF server-side), `ZonePanel.tsx`, possibly a new timeline component.

### 3. Optional: genericize on-map street labels for privacy
**Why:** privacy PR removed the address + survey, but `BaseMap.tsx` still hard-labels "Eastview Cir" / "Baltimore Drive", which identifies the location.
**Do:** decide with the owner — replace with generic cardinal/"street"/"alley" labels, or leave. Trivial edit in `BaseMap.tsx` if yes.

### 4. Prune asset-tooling dependencies
**Why:** `pdf-parse`, `pdf-to-img`, `sharp` are devDependencies used only for one-off survey rasterization / SVG previews, not by the app at runtime. `rasterize-pdf.mjs` uses them.
**Do:** confirm nothing in `src/` imports them (it doesn't), then either drop them + `rasterize-pdf.mjs`, or move to a clearly-labeled `tools/` area. Keeps installs lean.

### 5. Google SSO (v2 auth)
**Why:** v1 uses a shared edit password; the spec planned Google SSO with an email allow-list as v2.
**Do:** swap the cookie gate for Supabase Auth (Google provider) — replace `requireEdit()`'s cookie check with a Supabase session check; allow-list emails. The data model already accommodates this (no schema change). Requires Google OAuth client setup in Google Cloud + Supabase Auth config (owner-side dashboard steps).
**Touches:** `src/lib/require-edit.ts`, `edit-mode.tsx`, `EditToggle.tsx`, the `/api/edit/*` routes (can be removed/replaced).

### 6. Optional infra: autonomous migrations
**Why:** schema changes currently need a manual SQL-Editor paste. `scripts/migrate.mjs` can run them automatically.
**Do:** if the owner pastes the direct connection URI into `SUPABASE_DB_URL` in `.env.local`, future migrations run via `node scripts/migrate.mjs`. No code change needed — just the env value. (Note: this is the DB superuser password; a scoped Supabase Management API token is a safer alternative if preferred.)

### 7. General accessibility & polish pass
- Keyboard/focus states on the SVG zone buttons and editor handles.
- `alt`/`aria` review across forms and the photo gallery.
- Consider `next/image` (with Supabase remote-pattern config) for zone photos instead of plain `<img>`.

---

## Already done (for reference — don't redo)
v1 Plans 1–6 (foundation, edit gate, map+panel, tracker, shape editor, BHL styling + deploy); privacy scrub; survey-accurate base map; zone photos; clearer shape editor (FR2); zone add/archive (FR1); independent map labels (FR3). Triangle/The Field and the Hellstrip shape were fixed by the owner directly.
