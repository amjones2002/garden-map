# Interactive Yard Map & Plant Purchase Tracker — Design Spec

**Date:** 2026-06-20
**Property:** 1105 Eastview Cir, Richardson, TX — Lot 27, Block P, corner lot, 0.2962 acres (12,901 sq ft)
**Status:** Approved design, pending implementation plan

---

## 1. Overview

A mobile-first web app with two linked parts:

1. **Illustrated, clickable yard map** — a stylized SVG of the property traced from the plat survey. Tapping a zone opens a slide-up panel showing that zone's description, photos, current plants, and recent purchases.
2. **Plant purchase tracker** — a database-backed table logging plant purchases (name, date, vendor, price, quantity, zone, status, notes) with add/edit/delete, sort/filter, CSV import + export.

The app is **public read-only**; editing is gated behind a shared password (v1) with Google SSO planned for v2. All routine data changes happen through the UI — no code or config edits for day-to-day use.

### Primary use context
1. **In the yard, on a phone.** Mobile-first is a hard requirement, not a nice-to-have — the gardener uses it standing in the beds to check and log plants.
2. **Sharing with remote friends and relatives.** A taste of the Texas Prairie and Desert wherever they may be. The public read-only view must be genuinely *delightful* to browse for distant viewers — beautiful, not merely functional.

These two contexts pull the design toward the same place: a fast, touch-friendly map that is also a pleasure to look at.

---

## 2. Scope

### In v1
- Map view with tap-to-open zone detail panel
- Per-zone editable "current plants" list
- Zone photos with capture timestamps (Supabase Storage), shown as a chronological per-zone gallery — foundation for future seasonal timelines (§11)
- Global purchase tracker: CRUD, sort/filter, CSV **import** and **export**
- Lenient bulk importer for migrating existing plant/purchase records
- Plant name catalog seeded from NPSOT + WildflowersOrg, driving autocomplete
- On-demand single-plant lookup (Missouri Botanical Garden) for non-native gaps
- Edit gate via shared password (httpOnly cookie + server-side write routes)
- Zone shape editor (polygon drawing over the survey image)
- Hand-drawn garden-map styling

### Deferred to v2
- Google SSO (Supabase Auth) with email allow-list
- Anything not listed above

### Notes on scope decisions
- **CSV export** was originally deferred but is included because the import parser makes export nearly free.
- The **shape editor is in v1** (originally drafted as a later phase). It still builds last, after the core map/tracker work, but ships in v1.

---

## 3. Architecture & Stack

```
Next.js (App Router) on Vercel
   ├── /         Map view            (public read)
   ├── /tracker  Global purchase table (public read)
   └── /editor   Zone shape editor    (gated)

Supabase
   ├── Postgres   zones, plants, purchases, zone_photos, vendors, plant_catalog
   ├── Storage    zone-photos bucket
   └── Auth       (deferred to v2)
```

### Read path (public)
Browser → Supabase **anon key** → Postgres, with **Row Level Security allowing public `SELECT`** on all tables. No login required to view the map or tracker.

### Write path (gated)
All add/edit/delete operations route through **Next.js API routes** — the browser never writes directly to Supabase. Each write route:
1. Validates a signed, httpOnly **edit-session cookie** (set when the user enters the shared password).
2. If valid, performs the write using the Supabase **service-role key**, held server-side only and never shipped to the client.

RLS blocks all writes at the database level; only the service-role key bypasses it. The shared password is validated server-side and exchanged for the session cookie — the password itself never travels to the client.

### Why this shape
The v2 SSO upgrade is clean: swap the cookie check for a Supabase Auth session check. The data model does not change between v1 and v2.

### Hosting / cost
- Vercel free tier → working `*.vercel.app` URL, no domain purchase needed.
- Supabase free tier (500 MB DB, 1 GB storage).
- Custom domain (~$10–15/yr) optional later.

---

## 4. Data Model

Six tables. Key design decision: a zone's **"current plant list"** (curated, what's growing there now) and the **purchase log** (transactional history) are **separate**, matching the two distinct things the zone panel displays.

```
zones
  id            uuid pk
  slug          text unique         -- "hellstrip"
  name          text                -- "Hellstrip"
  label         text                -- hand-lettered map label ("The Field")
  description   text
  shape         jsonb               -- [{x,y},...] normalized 0–1 polygon points
  fill_color    text                -- palette color for the zone
  sort_order    int
  created_at    timestamptz

plants                              -- editable "currently planted here" list
  id            uuid pk
  zone_id       uuid fk -> zones
  common_name   text
  botanical_name text null
  catalog_id    uuid fk -> plant_catalog null   -- link to catalog when matched
  sort_order    int

purchases                           -- the tracker log
  id              uuid pk
  zone_id         uuid fk -> zones null   -- a purchase may be unassigned
  common_name     text
  botanical_name  text null
  catalog_id      uuid fk -> plant_catalog null
  vendor_id       uuid fk -> vendors null
  purchase_date   date null
  price           numeric null
  price_estimated boolean default false   -- true for guesstimates / migrated rows
  quantity        int default 1
  status          text                    -- 'planted'|'pending'|'replaced'|'died'
  notes           text null
  created_at      timestamptz
  updated_at      timestamptz

vendors
  id          uuid pk
  name        text unique        -- "Calloway's", "North Haven Gardens", "Data Migration"
  url         text null
  notes       text null
  sort_order  int

zone_photos
  id            uuid pk
  zone_id       uuid fk -> zones
  storage_path  text                   -- path in zone-photos bucket
  caption       text null
  taken_at      timestamptz null       -- when the photo was taken (EXIF or manual); drives seasonal ordering
  uploaded_at   timestamptz default now()
  sort_order    int                    -- manual override; default order is chronological by taken_at

plant_catalog                          -- seeded from NPSOT + WildflowersOrg
  id                  uuid pk
  scientific_name     text
  common_name         text
  other_common_names  text null
  growth_form         text null
  height_min          numeric null
  height_max          numeric null
  spread_min          numeric null
  spread_max          numeric null
  light               text null         -- "Sun, Part Shade"
  water               text null         -- "Low, Medium"
  soil                text null
  bloom_season        text null
  bloom_color         text null
  wildlife_benefit    text null
  native_habitat      text null
  ecoregions          text[] null       -- from WildflowersOrg regional lists
  is_tx_native        boolean default true
  source              text              -- 'npsot.org' | 'wildflower.org' | 'missouribotanical'
  source_url          text null
  created_at          timestamptz
```

### Constraints / conventions
- `purchases.status` is plain text with a CHECK constraint (`planted`, `pending`, `replaced`, `died`) — simpler to evolve than a Postgres enum.
- `zones.shape` is stored as **normalized 0–1 coordinates** so polygons scale to any phone viewport / SVG viewBox.
- A purchase optionally auto-adds to a zone's plant list (see §6.2).

---

## 5. Plant Catalog & Data Ingestion

The catalog powers autocomplete in every plant/purchase form: type a common name → scientific name, sun, and water needs auto-fill.

### Source files (already in repo)
- `NPSOT/plant-list.csv` — **primary source.** 25 columns: Scientific Name, Common Name, Plant URL, Other Common/Scientific Names, Growth Form, Ecoregion III/IV, Height, Spread, Leaf Retention, Lifespan, Soil, Light, Water, Native Habitat, Bloom Season/Color, Seasonal Interest, Wildlife Benefit, Maintenance, Comments, References. Sanctioned member export from the official NPSOT "Native Plant Table."
- `WildflowersOrg/*.htm` — 11 EPA Level III ecoregion lists (Cross Timbers, Texas Blackland Prairies, etc.). Clean 6-column tables: Scientific Name | Common Name | Duration | Habit | Sun | Water. Heavy overlap with NPSOT; unique value is **ecoregion membership**.
- `1105eastview_Survey - New.PDF` — vector plat survey (see §7).

### Seed script (one-time)
1. Parse `NPSOT/plant-list.csv` with a **real CSV parser** (quoted fields contain embedded newlines — line-splitting will corrupt rows). Map columns into `plant_catalog` with `source = 'npsot.org'`, `source_url = Plant URL`.
2. Walk the 11 `WildflowersOrg/*.htm` tables, dedup by `scientific_name`, and attach `ecoregions[]` to matching catalog entries. (Richardson straddles **Texas Blackland Prairies** and **Cross Timbers**.)
3. Non-native garden plants not in NPSOT (Kaleidoscope/Canyon Creek Abelia, Taylor Juniper, catmint, liriope, dwarf mondo) are added later via on-demand lookup.

### Do NOT scrape
The NPSOT database pages return **HTTP 403** to automated tools (bot protection). We use only the **sanctioned CSV/XLSX export** the user already downloaded. We use the **CSV**, not the XLSX, to avoid the XLSX's two-row category header. Stored fields are factual horticultural attributes plus a source link — not wholesale mirroring of long descriptions or images.

### On-demand lookup ("Look up online")
When the user adds a plant absent from the catalog, a single button fetches **one** record from Missouri Botanical Garden (for non-natives) or wildflower.org (natives), shows the scientific name, and offers to save it to the catalog. Fetching stays rare, single-record, and user-triggered — never a background crawler.

---

## 6. App Views & Features

### 6.1 Map view (`/`)
- Stylized SVG yard map (see §7) with visually distinct, tappable zones.
- Tap/hover highlight; zones large enough to tap reliably on a phone.
- Tapping a zone opens a **slide-up panel / modal** showing:
  - Zone name + short description
  - **Zone photo gallery** — timestamped photos for that zone, shown **chronologically by `taken_at`**. On upload, capture the date taken (from EXIF when present, else manual/upload time). This is the foundation for the "through the seasons" timeline (see §11). Upload/delete gated behind the edit password.
  - **Current plant list** (editable when unlocked)
  - **Recent purchase history** for that zone
  - **"Add purchase"** button, pre-filled with that zone

### 6.2 Tracker view (`/tracker`)
- Global table of all purchases.
- Sort and filter by zone, date, status, vendor.
- Inline add/edit/delete (edit controls visible only when unlocked).
- **Purchase form:** plant name (catalog autocomplete), botanical name, **zone dropdown** (+ "unassigned"), **vendor dropdown** with inline "+ add new vendor", purchase date, price, `price_estimated` toggle, quantity, status, notes.
- **Auto-add to plant list:** when a purchase has a zone, a checkbox "Also add to this zone's plant list" appears — **default checked when status is `planted`**, unchecked otherwise.
- **CSV export** of the current (filtered) view.

### 6.3 Bulk import
- Download a **template CSV** with the right headers.
- Upload → **preview table** showing how rows parse, with warnings (e.g., "zone 'Triangle' not found — will import unassigned").
- Confirm → rows land in `purchases`.
- **Lenient parsing:** only `common_name` required; every other column optional and blank-tolerant.
- **Unknown vendor** → falls back to the seeded **"Data Migration"** vendor; known vendors are matched or auto-created.
- Migrated rows get `price_estimated = true` so guesstimate prices are visually distinguished (e.g., "~$12") and filterable for later backfill.
- Import is gated behind the edit password like all writes.

### 6.4 Edit gate
- "Unlock editing" control prompts for the shared password.
- Password posts to a server route → validated against `EDIT_PASSWORD` env var → issues signed httpOnly cookie.
- UI reveals edit controls when the cookie is present; all writes re-check it server-side.
- "Lock" clears the cookie.

---

## 7. Map Base, Shape Editor & Styling

### 7.1 Base map (accurate trace from survey)
The survey PDF is **vector** (no extractable text — labels are outlined paths). It has been rendered to `survey-page-1.png` (1836×3024) for reference and as the editor background.

Reconstructed boundary geometry (to scale):
- **NW frontage (Eastview Cir):** curved, radius **224.11'**, arc ~112'
- **SW corner:** 28.28' chamfer (45° clip) where Eastview Cir meets Baltimore Drive
- **South frontage:** Baltimore Drive (50' R.O.W.)
- **East side (alley):** straight, **88.34'**
- **North side (Lot 28 line):** **130.21'**

Interior hardscape positioned from the survey: **One Story Brick** house (center-left), **Covered Porch** (west side of house), **Conc. Patio** (SE of house), **Pool** (east side near alley), concrete walks/pads, wood fence (SE). These render as neutral hardscape under the colored zones.

### 7.2 Zones (seeded with placeholder shapes, refined in editor)
Initial seed from the project brief:
- **Hellstrip** — curved corner bed at Eastview Cir / Baltimore corner (frog fruit, bluebonnets, black-eyed Susans, echinacea)
- **Foundation Bed** — ~50 ft along the house (Taylor Junipers, Canyon Creek & Kaleidoscope Abelias, liriope/dwarf mondo front edge, asparagus)
- **Cedar Planters** — two raised beds on the covered pool patio (herbs, ornamentals)
- **Pool & Spa**
- **Dry Mineral Bed** — sotol, Penstemon baccharifolius, Asclepias tuberosa
- **Front Raised Bed (8×3)** — giant coneflowers, Turk's cap, homestead verbena
- **North Side Yard** — summer annuals, catmint, dwarf sunflowers
- **Stock Tank Fountain area** — milkweed and monarch habitat

**To confirm with user against the drafted base map before finalizing:** zone boundaries/labels generally, and especially **"Triangle"** and **"The Field"** (informal names not on the survey — user will point out their locations once the draft map exists).

### 7.3 Shape editor (`/editor`, gated)
- Loads `survey-page-1.png` as a static background layer.
- Click/tap to drop polygon points; drag existing points to adjust.
- Close shape by clicking the first point again or double-click/double-tap.
- **Touch-first:** tap to place, drag to adjust.
- Saves each zone's outline as a normalized 0–1 coordinate array (JSON) to `zones.shape`.
- The live map renders zones from this same coordinate data — editing a shape updates the real map immediately.
- Replaces hand-tracing coordinates outside the app.

### 7.4 Visual style
- **Vintage botanical-illustration aesthetic, in the spirit of the Biodiversity Heritage Library** — antique natural-history plates: fine copperplate-engraving linework, aged-paper ground, muted plate textures. The map should feel like a hand-drawn naturalist's survey, not a literal photo or a generic floor plan / dashboard.
- **Plant & zone accents** rendered as botanical-plate-style illustrations (engraving line art), layered over the map.
- **Wood-element feng shui palette** as the color accents: lime/chartreuse greens, burgundy-purple accents, earthy neutrals for paths/hardscape — applied over the aged-paper base.
- **Hand-lettered zone labels** (web font such as *Caveat* / *Patrick Hand*), evoking a naturalist's annotations.
- Subtle SVG roughen filter so edges look sketched/engraved, not CAD-straight.
- Mobile-first layout throughout, and beautiful enough to enjoy as a remote viewer (see §1 use context 2).

**Sourcing note:** BHL imagery is largely public domain, but provenance varies. Any illustration assets pulled from BHL or similar archives must be confirmed public-domain / appropriately licensed and attributed before use; otherwise we use original engraving-style line art in the same spirit.

---

## 8. Testing & Build Order

### Testing approach
- **TDD throughout** (Vitest + React Testing Library).
- Unit-test: CSV import parsing (incl. multiline quoted fields), lenient field mapping, vendor fallback, normalized-coordinate math.
- API-route tests: edit-cookie gating (write blocked without password, allowed with), CRUD round-trips.
- **Playwright smoke test:** tap a zone → panel opens; place + close a polygon in the editor → shape persists.

### Build phases
1. Next.js scaffold + two views (`/`, `/tracker`) + navigation.
2. Supabase schema + seed `plant_catalog` (NPSOT CSV + WildflowersOrg ecoregions) + seed zones/vendors.
3. Draft accurate base map from survey geometry; **get user confirmation on boundaries/labels, esp. Triangle & The Field.**
4. Zone detail panel (photos, current plants, recent purchases, add-purchase).
5. Tracker CRUD + sort/filter + CSV import (lenient) + CSV export.
6. Edit-password gate (cookie + server write routes + RLS).
7. Zone shape editor; use it to trace real bed outlines, replacing placeholders.
8. Styling polish: illustrated look, hand-lettered labels, wood-element palette.
9. Deploy to Vercel; confirm everything works well on mobile.

---

## 9. Open Items / User Inputs Needed

- **Zone boundaries & labels** — confirm against drafted base map (Phase 3), especially **Triangle** and **The Field** locations.
- **Vendor seed list** — user's regular vendors (or leave empty to fill in-app). "Data Migration" is always seeded.
- **Existing data file** — user's historical purchases/plants for the bulk importer (prices are guesstimates → `price_estimated`; unknown sources → "Data Migration").
- **`gh` CLI** is not installed on the dev machine; needed for GitHub PR workflows / smoother Vercel deploy. Optional but recommended.
- **Supabase project** — ✅ created (`project_ref` rdckuaoxcxfnpjpeussk). Access via the **Supabase MCP** (configured in `.mcp.json`) for schema/seed/storage; the `anon` key goes in `.env.local`, the `service_role` key stays server-side only. SSO is deferred to v2.

---

## 10. Reference Materials (in repo)

- `1105eastview_Survey - New.PDF` — vector plat survey
- `survey-page-1.png` — rendered survey (editor background + base-map trace reference)
- `NPSOT/plant-list.csv` — native plant catalog source (primary)
- `NPSOT/plant-list.xlsx` — same data, XLSX (two-row category header; CSV preferred)
- `WildflowersOrg/*.htm` — 11 ecoregion lists (ecoregion tagging + sun/water cross-reference)

---

## 11. Future Directions (post-v1)

Documented to guide v1 data choices, not built in v1:

- **"Through the seasons" timelines** — using `zone_photos.taken_at`, render a scrubbable chronological gallery per zone (and eventually a whole-yard view) showing the same bed across seasons and years. v1 captures the timestamps so this is purely a presentation layer later.
- **Google SSO** with email allow-list (Supabase Auth) — replaces the shared-password gate; data model already accommodates it.
- **Plant detail pages** — rich per-plant view drawing on the `plant_catalog` horticultural fields (bloom season, wildlife benefit, sun/water) for remote viewers learning about Texas natives.
- **Spend & inventory analytics** — per-vendor spend, plant survival rates (via `status`), confirm-estimated-prices workflow.
- **Photo enrichment** — EXIF GPS to auto-suggest a zone; bloom/phenology tagging.
