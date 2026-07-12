# Photo Timeline — Phase 2 Design

**Date:** 2026-07-11
**Status:** Approved (design); implementation plan pending
**Depends on:** Phase 1 — [photo-classification-pipeline-design](2026-07-11-photo-classification-pipeline-design.md)
(merged to `main` in PR #18: schema `0005`/`0006`, `src/lib/zone-classifier.mjs`,
`scripts/import-photos.mjs`).

## Goal

Phase 1 classified the ~3,038-photo historical export into `zone_photos` — every
row carries a `review_status`, an AI zone/area guess (`ai_zone_slug`, `ai_area`,
`ai_confidence`), and a rich `ai_meta` payload. High-confidence beds auto-confirmed;
the rest (~1,000+, and growing as the batch collect completes) sit as `pending`.

Phase 2 makes that pipeline usable by a human, and extends it to new photos:

1. **Review queue** — an edit-gated UI to clear the `pending` backlog: confirm the
   AI's zone/area, reassign to a different zone, or reject.
2. **Live classify on upload** — a zone-agnostic uploader that runs the shared
   classifier on each new photo in real time and pre-selects the suggested zone
   (suggest-and-confirm), plus a map-page entry point for it.

Both reuse the Phase 1 classifier and the same `zone_photos` / `review_status`
model. The narrative/eras pass (Phase 1's noted item 3) is **out of scope** here.

## Context: what already exists (and what's stale)

- **DB schema is fully migrated** (`0005`/`0006` applied to the live project):
  `zone_photos` has nullable `zone_id`, `area`, `review_status`
  (`pending|confirmed|rejected`), `source` (`manual|batch_import|phone_sync`),
  `source_ref`, `ai_zone_slug`, `ai_area`, `ai_confidence`, `ai_model`, `caption`,
  `is_yard`, and `ai_meta jsonb`. `zones` has `area` (`front|pool|south`).
- **RLS** already restricts public/anon reads to `review_status = 'confirmed'`, so
  the public map and `ZonePanel` never see `pending` rows — no map changes needed
  for correctness.
- **Shared classifier** — `src/lib/zone-classifier.mjs` exports `buildSystemPrompt`,
  `buildClassificationSchema`, `classifyImage(client, {...})`, `parseClassification`,
  `MODEL`, `AREAS`. Reused verbatim; **no prompt/schema duplication.**
- **Upload plumbing** — `GET /api/zone-photos/upload-url` (signed upload URL) and
  `POST /api/zone-photos/confirm` (insert row) exist and are edit-gated. The confirm
  route relies on DB defaults (`source='manual'`, `review_status='confirmed'`).
- **Deps present** — `@anthropic-ai/sdk` ^0.111.0, `sharp` ^0.35.2, `exifr` ^7.1.3.
  `ANTHROPIC_API_KEY` is a documented server-side secret (`.env.example` / Vercel).
- **Stale TypeScript types (must fix as groundwork):** `src/lib/types.ts` `Zone` and
  `ZonePhoto` predate Phase 1 — they lack `area`, `review_status`, nullable
  `zone_id`, `source`, `ai_*`, `is_yard`, and `ai_meta`. Phase 2 extends both to
  match the migrated schema (with an `AiMeta` type for the jsonb shape).

## Non-goals

- No narrative/eras synthesis pass (deferred to a later branch).
- No phone-sync producer (the `source='phone_sync'` enum value already exists; the
  producer is not built here).
- No schema migration — Phase 2 is read/update + one new classify route.
- No thumbnail generation — one stored size, Next `<Image>` resizes per viewport.
- No changes to the public map's read path.

## Architecture

Two new surfaces, both behind the edit gate (`requireEdit()`), both Node-runtime
API routes (sharp + Anthropic need Node, not edge):

- A **`/photos` page** with two tabs — *Add new photos* (default) and
  *To review* — plus an auto-tag log under the review tab.
- A **`PATCH /api/zone-photos/review`** route — bulk status/zone updates.
- A **`POST /api/zone-photos/classify`** route — one real-time Sonnet call.
- A **map-page "Upload photos" button** (edit mode) linking to `/photos`.

The two tabs funnel into the same end state (a `confirmed` row with a `zone_id`),
from opposite ends of time: *To review* triages the already-tagged historical
backlog; *Add new photos* classifies brand-new uploads.

### Data model

No migration. TypeScript groundwork only, in `src/lib/types.ts`:

```ts
export type Area = "front" | "pool" | "south";
export type ReviewStatus = "pending" | "confirmed" | "rejected";
export type PhotoSource = "manual" | "batch_import" | "phone_sync";

export type AiMeta = {
  quality?: "good" | "ok" | "poor";
  reasoning?: string;
  tags?: string[];
  plants?: string[];
  hardscape?: Record<string, boolean>;
  botanical?: { bloom_colors?: string[]; notes?: string };
  // forward-compatible: other keys tolerated
};
```

`Zone` gains `area: Area | null`. `ZonePhoto` gains `zone_id: string | null`,
`area: Area | null`, `review_status: ReviewStatus`, `source: PhotoSource`,
`ai_zone_slug`, `ai_area`, `ai_confidence`, `ai_model`, `is_yard`, and
`ai_meta: AiMeta`.

### Zones/areas helper — `src/lib/zones.ts`

A small shared module (client- and server-safe) with:
- `AREA_ORDER: Area[] = ["front", "pool", "south"]` and `AREA_LABELS`.
- `groupPendingByAreaZone(photos, zones)` — pure function producing the
  Area → Zone → photos[] structure the review UI renders (with an "area-only"
  bucket per area for `ai_zone_slug = null`). Unit-tested.
- `areaForZone(zoneId, zones)` — look up a zone's area (used when confirming /
  reassigning to keep `area` consistent with `zone_id`).

## Feature 1 — Review queue (`/photos`, "To review" tab)

### Loading the queue

The page is a server component that gates on `requireEdit()` (redirect to `/` if
locked) and needs `pending` rows — which anon RLS hides. It reads via the
**service-role** server client (`getServerSupabase`) for `zone_photos` where
`review_status='pending'`, plus all `zones`. Data passed to a client component.

### Grouping & display (two-level, Area → Zone)

- Top-level sections in `AREA_ORDER`: **Front**, **Pool**, **South**.
- Within each area, one group per `ai_zone_slug` (zone name + count), ordered by
  count desc; then a **"{Area} — needs a bed"** bucket for that area's
  `ai_zone_slug = null` photos.
- Each group renders a thumbnail grid (`publicPhotoUrl` + Next `<Image>`); each
  thumb shows `ai_confidence` and toggles a per-photo state (selected / reassign /
  reject). Tapping a thumb opens a lightbox (reuse `ZonePanel`'s pattern) showing
  `caption`, `ai_meta.reasoning`, and `ai_meta.plants`.
- Photos are ordered within a group by `taken_at` (via `sortChronological`).

### Actions

- **Confirm all correct** (per zone group) — confirms every still-selected photo in
  the group to that group's zone.
- **Reassign** (per photo) — a zone `<select>`; moves the thumb to the target group
  (and area section if it crosses areas).
- **Reject** (per photo) — marks `review_status='rejected'`; the thumb greys out and
  is excluded from "confirm all". Reversible in-session.
- **Area-only bucket:** a photo cannot be confirmed without a bed — the reviewer
  must reassign it to a zone first (or reject it). "Confirm all" is disabled for the
  bucket; confirming happens per-photo after picking a zone.

### Write path — `PATCH /api/zone-photos/review`

Edit-gated, service-role. Body: `{ ids: string[], action: "confirm" | "reassign" |
"reject", zone_id?: string }`.
- `confirm` — requires each row already have a `zone_id` **or** a `zone_id` in the
  body; sets `review_status='confirmed'`, and (re)derives `area` from the zone.
- `reassign` — requires `zone_id`; sets `zone_id`, derives `area`, and
  `review_status='confirmed'` (reassigning is an implicit confirm).
- `reject` — sets `review_status='rejected'` (leaves `zone_id`/`area` untouched).
- Validates `zone_id` exists; rejects a `confirm` with no resolvable zone (guards
  the area-only case) with a 400. Bulk = one request, many `ids` (single
  `update ... in (ids)` per distinct target).

### Auto-tag log (section under the "To review" tab)

Auditable history of what the AI decided without a human: `zone_photos` where
`review_status='confirmed'` and `ai_zone_slug is not null` (i.e. batch/AI-confirmed,
not the 17 pre-existing manual rows). Newest first, showing thumb + AI zone/area +
confidence + date. **Paginated and filterable by area/zone** (server-side range
queries, ~1,900 rows and growing — never a single mega-list). Each entry has a
**Re-open** action routed through the same `PATCH` route: `reject`, or `reassign`
to a different zone.

## Feature 2 — Live classify uploader ("Add new photos" tab + map button)

### Flow

1. User drops N new photos. For each: client reads EXIF `taken_at`
   (reuse `getExifDateTaken` from `ZonePanel`), then gets a signed URL from the
   `upload-url` route and PUTs the file to storage. The object lands under a neutral
   prefix (e.g. `_inbox/<uuid>.<ext>`) since the zone isn't known yet; the final
   `storage_path` is kept and reused on save (no re-upload / no move). **The
   `upload-url` route (`GET`) currently *requires* `zone_id` and builds the path as
   `${zone_id}/<uuid>` — extend it to accept a zone-agnostic call (no `zone_id` →
   `_inbox/<uuid>`), leaving the per-zone `ZonePanel` behavior unchanged.**
2. Client calls `POST /api/zone-photos/classify` with `{ storage_path }`.
3. UI shows each photo with its AI-suggested zone **pre-selected** in a `<select>`
   (defaulted to `zone_slug`, or the area's zones if only an area came back),
   confidence, and caption. `is_yard=false` surfaces a "doesn't look like the yard —
   skip?" gate.
4. **Save** writes each row via `POST /api/zone-photos/confirm` (extended — see
   below) with `source='manual'`, `review_status='confirmed'` (a human just
   approved it, so it skips the pending queue), `zone_id`/`area` from the selection,
   `taken_at`, and the classifier output persisted to `ai_zone_slug`, `ai_area`,
   `ai_confidence`, `ai_model`, `caption`, `is_yard`, `ai_meta`.

### `POST /api/zone-photos/classify` (new, Node runtime, edit-gated)

- `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` — key never reaches the
  browser.
- Downloads the object from the `zone-photos` bucket via service-role, downscales
  with `sharp` to ≤1568px long edge (Sonnet downsamples past that — larger is wasted
  tokens), base64-encodes.
- Loads live `zones`, builds `buildSystemPrompt(zones)` +
  `buildClassificationSchema(zoneSlugs)`, calls `classifyImage(client, {...})`.
- Returns the parsed classification JSON. Errors (API failure, missing object) →
  4xx/5xx with a message; the UI falls back to a manual zone pick for that photo.

### `POST /api/zone-photos/confirm` (extended)

Accepts the optional Phase 2 fields (`area`, `review_status`, `source`,
`ai_zone_slug`, `ai_area`, `ai_confidence`, `ai_model`, `is_yard`, `ai_meta`) and
persists them when present, defaulting to today's behavior when absent (so the
per-zone `ZonePanel` uploader keeps working unchanged). Still edit-gated;
best-effort storage cleanup on insert error is preserved.

### Map-page entry point

An **"Upload photos"** button on `src/app/page.tsx` (or `Nav`), shown only in edit
mode, linking to `/photos` (which defaults to the *Add new photos* tab). Navigate
rather than modal — one uploader implementation, revisitable later.

## Error handling

- **Classify failures** — per-photo, isolated: one failed classify doesn't block the
  batch; that photo shows an error state and a manual zone `<select>`.
- **Partial save** — saving N photos reports per-photo success/failure (mirrors the
  existing `uploadPhotos` pattern in `ZonePanel`); failed rows stay editable.
- **Review writes** — a failed `PATCH` surfaces an inline error and leaves the
  in-session selection intact for retry (no optimistic loss).
- **Stale counts** — the backlog grows while the import collects; the queue shows a
  refresh affordance and counts are read fresh on load.
- **Edit gate** — every new route and the `/photos` page enforce `requireEdit()`;
  locked users are redirected/401'd.

## Testing

Follows the existing `tests/` + TDD pattern (Phase 1 has `tests/zone-classifier.test.ts`,
`tests/import-core.test.ts`).

- **`src/lib/zones.ts`** — unit tests for `groupPendingByAreaZone` (area ordering,
  zone grouping by count, area-only bucketing, empty areas) and `areaForZone`.
- **Review route** — status transitions (confirm requires resolvable zone; reassign
  derives area; reject leaves zone; confirm on area-only with no zone → 400), bulk
  ids. Supabase client mocked.
- **Classify route** — happy path returns parsed shape; zone loading; Anthropic
  client + sharp + storage download mocked; error → 4xx.
- **Confirm route** — new fields persist when present; legacy body still works.
- **Manual/preview** — dev server: classify + save a photo, confirm it appears in
  the zone panel; confirm a review group and verify it leaves the pending set and
  shows on the map.

## New / changed files

**New**
- `src/app/photos/page.tsx` — edit-gated server component; loads pending + zones.
- `src/app/photos/PhotosTabs.tsx` (+ child client components for the review grid,
  area-only bucket, auto-tag log, and the uploader).
- `src/app/api/zone-photos/review/route.ts` — `PATCH` bulk update.
- `src/app/api/zone-photos/classify/route.ts` — `POST` real-time classify.
- `src/lib/zones.ts` — area ordering/labels, `groupPendingByAreaZone`, `areaForZone`.
- Tests as above.

**Changed**
- `src/lib/types.ts` — extend `Zone`/`ZonePhoto`, add `Area`/`ReviewStatus`/
  `PhotoSource`/`AiMeta`.
- `src/app/api/zone-photos/confirm/route.ts` — accept/persist Phase 2 fields.
- `src/app/api/zone-photos/upload-url/route.ts` — allow zone-agnostic uploads
  (no `zone_id` → `_inbox/<uuid>` prefix).
- `src/app/page.tsx` and/or `src/components/Nav.tsx` — edit-mode "Upload photos"
  entry point.

## Open items for the implementation plan

- **Read AGENTS.md's Next.js note first:** this repo's Next.js has breaking changes —
  read `node_modules/next/dist/docs/` before writing any route handler / page /
  server-component code (server-component data loading, route-handler signatures,
  `requireEdit()` in a server component, edit-mode detection server-side).
- Exact page/tab component split and where edit-mode is detected for the map button
  (server vs. `useEditMode` client hook, as `ZonePanel` uses).
- Auto-tag log pagination page size and filter UI.
- Lightbox: reuse `ZonePanel`'s inline lightbox or extract a shared component.
- Whether the "Upload photos" button lives in `Nav` (global) or on the map page.
