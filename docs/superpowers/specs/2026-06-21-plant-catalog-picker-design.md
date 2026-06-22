# Purchase-Driven Plant Intake + Catalog Picker — Design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan

## Problem

Plants currently enter a zone two ways:

1. The **purchase intake** (`PurchaseForm`), which optionally mirrors a purchase into
   the `plants` table via an `also_add_to_plant_list` checkbox.
2. A **standalone free-text box** in `ZonePanel` that writes straight to the `plants`
   table with no purchase behind it and no link to the authoritative `plant_catalog`.

Path 2 is the source of bad data: typos, invented names, and rows with no `catalog_id`.
It also creates a parallel "currently planted" list that drifts out of sync with the
purchase log and has no lifecycle — a `plants` row is either present or deleted, with no
record that a plant was bought, planted, and later died.

## Decision

**Purchase is the single intake point.** A plant exists in a zone because it was
purchased and planted. There is no arbitrary "add a plant" path.

Concretely:

1. **The `plants` table is dropped.** A zone's "Currently planted" list is *derived* from
   its purchases.
2. **"Currently planted" = that zone's purchases with `status = 'planted'`.** The purchase
   `status` field is the plant lifecycle: `pending` (on order, not yet in ground),
   `planted` (alive in the zone), `replaced`, `died`. A plant that dies becomes a purchase
   with `status = 'died'` — it leaves the currently-planted view but stays in the tracker
   log as history.
3. **`purchase_date` is the planting date.** These are perishable goods planted within ~2
   days of purchase, so a separate planting date is unnecessary.
4. **The catalog picker lives in the purchase intake.** `PurchaseForm`'s free-text "Plant
   name" / "Botanical name" fields become a single catalog-backed typeahead that sets
   `common_name`, `botanical_name`, and `catalog_id`, with a free-text escape hatch for
   plants not in the catalog.

Duplicate detection is no longer needed: two plantings of the same species are simply two
purchase records, naturally distinct.

## Scope

In scope:
- Catalog search endpoint + ranking/sanitizer logic (testable).
- Catalog-backed typeahead in `PurchaseForm` with a free-text escape hatch, populating
  `catalog_id`.
- Deriving a zone's "Currently planted" list from purchases (`status = 'planted'`).
- Removing the `plants` table, the `/api/plants` route, the standalone add-plant box in
  `ZonePanel`, and the `also_add_to_plant_list` mirror.

Out of scope:
- Bulk CSV import of plants (the catalog is the reference; purchases are the intake).
- Changes to the tracker table/filters beyond what removing `plants` requires (none
  expected — TrackerTable already reads purchases).

## Data Model

Drop the `plants` table:

```sql
-- supabase/migrations/0004_drop_plants_table.sql
drop table if exists plants;
```

No new columns. `purchases` already has `catalog_id uuid references plant_catalog(id)`,
`purchase_date date`, and the `status` check constraint
(`planted`/`pending`/`replaced`/`died`).

Type changes in `src/lib/types.ts`:
- Remove the `Plant` type.

## Catalog Search Endpoint

New route: `GET /api/plant-catalog?q=<text>` — public read, **not** edit-gated (it only
reads the catalog, which already has a public-read RLS policy).

Behavior:
- Trim `q`. If under 2 characters, return `{ results: [] }`.
- Sanitize `q` to remove characters that break the Supabase `.or()` filter builder —
  specifically `%`, `,`, and parentheses — before interpolating.
- Query case-insensitively against both name columns:
  ```ts
  .or(`common_name.ilike.%${q}%,scientific_name.ilike.%${q}%`)
  ```
  (The `0001_init.sql` migration already provides lowercased indexes on `common_name`
  and `scientific_name`, anticipating this search.)
- Select only the fields the picker needs: `id, scientific_name, common_name,
  other_common_names`.
- `.limit(20)`.
- Return `{ results: [...] }` ranked by a pure function (see below).

Ranking lives in `src/lib/plant-catalog.ts` as a pure, unit-testable function:
1. Prefix matches (a name *starts with* `q`) rank above substring-only matches.
2. Within each tier, alphabetical by common name (falling back to scientific name when
   common name is null).

This mirrors the project's pattern of keeping logic testable in `lib/` (cf.
`parse-npsot`, `parse-wildflower`, `merge-catalog`).

## Catalog Picker in PurchaseForm

`PurchaseForm`'s "Plant name *" and "Botanical name" inputs (currently two free-text
fields backed by `common`/`botanical` state) are replaced by a catalog typeahead:

- A text input with a debounced (~250ms, 2+ chars) typeahead hitting
  `/api/plant-catalog?q=`. The dropdown shows the common name (bold) and botanical name
  (italic) for each match.
- **Pick a match** → sets the form's `common_name` + `botanical_name` from that row and
  captures `catalog_id`.
- **No match / want custom** → a trailing "Use '<your text>' as a custom plant" option →
  `catalog_id = null`, free-text `common_name`, optional free-text botanical name.
- When editing an existing purchase, the field pre-fills from the purchase's
  `common_name`; `catalog_id` is preserved if already set.

The picker is encapsulated in a reusable `PlantField` component so `PurchaseForm` stays
focused. The rest of `PurchaseForm` (zone, vendor, date, price, qty, status, notes) is
unchanged except for removing the `also_add_to_plant_list` checkbox.

`catalog_id` is added to `PurchaseForm`'s submit payload. The `POST`/`PATCH`
`/api/purchases` route already accepts and persists `catalog_id` (see
`cleanFields`), so no API change is needed for that.

## Purchases API Changes

`src/app/api/purchases/route.ts`:
- Remove the `also_add_to_plant_list` mirror block from `POST` (the `plants` insert).
- Remove `also_add_to_plant_list` from the `PurchaseInput` type.
- Everything else (including `catalog_id` handling) stays.

Delete `src/app/api/plants/route.ts` entirely.

## ZonePanel Changes

`src/components/ZonePanel.tsx`:
- Remove the `plants` state, its load query, the standalone add-plant `<form>`, the
  `addPlant`/`removePlant` functions, and the `newPlant` state.
- Replace the "Currently planted" section so it derives from purchases: query the zone's
  purchases with `status = 'planted'` and render their `common_name` / `botanical_name`.
  This can reuse the existing purchases load (raise its limit or add a dedicated
  `status = 'planted'` query) rather than a second table.
- Keep the "Recent purchases" and photo sections as-is.

## Error Handling

- Catalog search fetch failure in the picker → the dropdown simply shows no matches; the
  user can still use the free-text escape hatch. No blocking error.
- Purchase save errors are handled by the existing `PurchaseForm` error path (unchanged).

## Testing

Unit tests (vitest, matching existing style under `tests/`):
- `src/lib/plant-catalog.ts`:
  - search ranking (prefix > substring > alphabetical),
  - the `q` sanitizer.

The API route and React components stay thin and follow the project's existing convention
of not being directly unit-tested (cf. the current `purchases` and `purchases/import`
routes), with all decision logic pulled into `lib/`.

## Files Touched

- `supabase/migrations/0004_drop_plants_table.sql` — new migration (drops `plants`).
- `src/lib/types.ts` — remove the `Plant` type.
- `src/lib/plant-catalog.ts` — new: `CatalogResult` type, `sanitizeQuery`,
  `rankCatalogResults`.
- `src/app/api/plant-catalog/route.ts` — new: search endpoint.
- `src/app/api/plants/route.ts` — delete.
- `src/app/api/purchases/route.ts` — remove the `also_add_to_plant_list` mirror and field.
- `src/components/PlantField.tsx` — new: catalog typeahead field.
- `src/components/PurchaseForm.tsx` — use `PlantField`, add `catalog_id` to payload,
  remove the `also_add_to_plant_list` checkbox.
- `src/components/ZonePanel.tsx` — derive "Currently planted" from purchases; remove the
  standalone add-plant UI and `plants` queries.
- `tests/plant-catalog.test.ts` — new: unit tests for the `lib/` logic.

## Migration / Data Note

Dropping `plants` is destructive. Any existing `plants` rows that were created via the old
standalone box (not backed by a purchase) will no longer appear, by design. Rows that were
mirrored from purchases are already represented by their purchase records. The maintainer
applies the migration deliberately (`node scripts/migrate.mjs 0004_drop_plants_table.sql`).
