# Plan 4 — Purchase Tracker

**Goal:** A global purchase table with sort/filter, gated add/edit/delete, vendor inline-add, auto-add-to-plant-list, plus lenient CSV import and CSV export.

**Architecture:** Pure helpers (`src/lib/purchases.ts`) for status list, CSV export, filtering, sorting, and lenient import-row normalization — all unit-tested. Gated routes `/api/purchases` (POST/PATCH/DELETE) and `/api/purchases/import` (POST, with `?dryRun=1` preview) reuse `requireEdit` + service-role client and resolve zone (slug/name→id) and vendor (name→id, find-or-create, fallback "Data Migration"). The `/tracker` page reads via anon and renders table + controls; export builds CSV client-side from the pure helper.

## Global constraints
- Imported rows: `price_estimated = true`; unknown vendor → "Data Migration"; only `common_name` required.
- Status ∈ planted|pending|replaced|died (default planted).
- Writes gated; reads public.

## Files
- `src/lib/purchases.ts` — `PURCHASE_STATUSES`, `toCsv`, `filterPurchases`, `sortPurchases`, `normalizeImportRow`
- `src/app/api/purchases/route.ts` — POST/PATCH/DELETE (gated); POST supports `also_add_to_plant_list`
- `src/app/api/purchases/import/route.ts` — POST: parse CSV (csv-parse), normalize, dry-run preview or insert
- `src/components/PurchaseForm.tsx` — add/edit form (zone + vendor selects, inline vendor add, status, estimated, auto-add)
- `src/components/TrackerTable.tsx` — table + filters + sort + export + import
- `src/app/tracker/page.tsx` — render TrackerTable
- Tests: `tests/purchases.test.ts`

## Tasks
1. **purchases lib (TDD)** — statuses, toCsv, filter, sort, normalizeImportRow. Commit.
2. **/api/purchases** — gated CRUD; auto-add-to-plant-list on create. Commit.
3. **/api/purchases/import** — gated; dry-run + insert; vendor/zone resolution. Commit.
4. **PurchaseForm** — add/edit with vendor inline-add + auto-add checkbox. Commit.
5. **TrackerTable** — table, filters (zone/status/vendor/search), sort, CSV export, CSV import w/ preview. Commit.
6. **Verify + merge** — tests, build, live preview (add a purchase unlocked; export; import a tiny CSV). Merge to main.
