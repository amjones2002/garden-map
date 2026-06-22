# Plant Catalog Picker — Design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan

## Problem

Plants are added to a zone's "currently planted" list through a free-text input in
`ZonePanel`. This produces bad data: typos, invented names, and no link to the
authoritative `plant_catalog` table (so `catalog_id` and `botanical_name` are always
left null). We want adding a plant to draw from the existing catalog to keep names
clean and linked, while still allowing the occasional plant that isn't catalogued.

Legitimate duplicates exist: the same species can be planted in different years and
tracked as separate entries (different ages). So the goal is to prevent *accidental*
duplicates and bad names — not to forbid intentional repeats.

## Scope

In scope:
- Catalog-backed typeahead picker for adding plants to a zone, with a free-text escape
  hatch for off-catalog plants.
- Optional planting date per plant entry.
- Batch staging: build up several plants, then save them in one action.
- Duplicate detection with a warn-but-allow policy.

Out of scope (decided during brainstorming):
- Bulk CSV import of zone plant lists. The catalog is the reference; plants are added
  one-at-a-time or in small staged batches, not loaded from external spreadsheets.
- Changes to the purchases/tracker flow.

## Data Model

One new optional column on `plants`:

```sql
-- supabase/migrations/0004_plant_planted_date.sql
alter table plants add column if not exists planted_date date;
```

`Plant` in `src/lib/types.ts` gains:

```ts
planted_date: string | null;
```

`string | null` is the established convention for date columns over the Supabase JSON
API (cf. `Purchase.purchase_date`, `ZonePhoto.taken_at`). The column is a real Postgres
`date`; it is serialized as an ISO string.

`catalog_id` and `botanical_name` already exist on `plants`. The picker starts
populating them when a catalog entry is chosen. Custom (off-catalog) plants keep
`catalog_id = null` and `botanical_name = null`, but may still have a `planted_date`.

## Search Endpoint

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
  (The `0001_init.sql` migration already provides lowercased indexes on
  `common_name` and `scientific_name`, anticipating this search.)
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

## Picker UI

A new `PlantPicker` component (separate file, to keep `ZonePanel` from growing). It is
shown only when edit mode is unlocked, replacing the current free-text add form.

Row builder:
- Text input with a debounced (~250ms, 2+ chars) typeahead hitting
  `/api/plant-catalog?q=`. The dropdown shows the common name (bold) and botanical name
  (italic) for each match.
- **Pick a match** → captures `catalog_id` + `botanical_name` from that row; the chosen
  common name displays as a confirmed chip so the user knows it is catalog-linked.
- **No match / want custom** → a trailing "Add '<your text>' as a custom plant" option →
  `catalog_id = null`, free-text `common_name`, no botanical name.
- An optional **planting date** input (`<input type="date">`, may be left blank).
- **"+ Add row"** drops the current selection into a staging list and clears the input.

Staging list:
- Shows each staged row: common name, botanical name (if any), planting date (if any),
  and an "×" to remove it.
- Rows flagged as duplicates (see below) show a warning marker.
- A **"Save N plants"** button commits the whole batch.

Single-add still works for the one-off case (a staging list of one).

## Duplicate Detection

Policy: **warn only when the entry is truly identical** — same species *and*
same-or-blank planting date. Legitimate duplicates (same species, different dates) are
allowed silently.

Definitions:
- **Same species:** same `catalog_id` when catalog-linked; for custom plants,
  case-insensitive `common_name` match.
- **Same/blank date:** both `planted_date` values equal, or both blank.

Two checks run at save time, both implemented as pure functions in
`src/lib/plant-catalog.ts`:
1. **Against the zone's existing `plants`** — a staged row matching an existing entry on
   species + same/blank date is flagged.
2. **Within the staging list** — two staged rows matching each other on species +
   same/blank date are flagged.

Flagged rows display a warning (e.g. *"Gregg's Mistflower (no date) is already in this
list. Add anyway?"*). The user can **Save anyway** or remove the flagged rows. Nothing is
blocked outright.

## Batch Insert API

`POST /api/plants` gains array support while preserving the existing single-add shape for
backward compatibility:

- Accepts either:
  - `{ zone_id, common_name, botanical_name?, catalog_id?, planted_date? }` (current
    shape), or
  - `{ zone_id, rows: [{ common_name, botanical_name?, catalog_id?, planted_date? }, ...] }`.
- Edit-gated via `requireEdit`, as today.
- Validates each row: `common_name` required and trimmed non-empty; `catalog_id`, if
  present, must be a valid uuid; `planted_date`, if present, must parse as a date.
- Inserts the valid batch in a single `supabase.from("plants").insert([...])` call.
- All-or-nothing: on DB error, return `{ error, inserted: 0 }` so the UI state stays
  truthful (no partial-insert ambiguity).
- On success, return `{ inserted: N, rows: [...] }` so the panel can update its list
  without a full reload.

## Error Handling (Client)

- Network / 500 error → inline error message in the panel; the staging list is preserved
  so the user loses nothing.
- Per-row validation failure from the server → mark the offending rows; keep the rest
  staged.

## Testing

Unit tests (vitest, matching existing style under `tests/`):
- `src/lib/plant-catalog.ts`:
  - search ranking (prefix > substring > alphabetical),
  - the `q` sanitizer,
  - duplicate detection against an existing list,
  - duplicate detection within a staging batch.

The API route and React component stay thin and follow the project's existing convention
of not being directly unit-tested (cf. the current `plants` and `purchases/import`
routes), with all decision logic pulled into `lib/`.

## Files Touched

- `supabase/migrations/0004_plant_planted_date.sql` — new migration.
- `src/lib/types.ts` — add `planted_date` to `Plant`.
- `src/lib/plant-catalog.ts` — new: search ranking, `q` sanitizer, dedup functions.
- `src/app/api/plant-catalog/route.ts` — new: search endpoint.
- `src/app/api/plants/route.ts` — add batch (array) support to `POST`.
- `src/components/PlantPicker.tsx` — new: typeahead + staging list.
- `src/components/ZonePanel.tsx` — swap the free-text add form for `PlantPicker`; render
  `planted_date` in the plant list.
- `tests/plant-catalog.test.ts` — new: unit tests for the `lib/` logic.
