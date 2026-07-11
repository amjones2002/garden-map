# Photo Classification Pipeline — Design

**Date:** 2026-07-11
**Status:** Approved (design); implementation plan pending

## Goal

Turn ~3,038 unlabeled historical yard photos (a 13.9 GB local export spanning ~1.5
years) into per-zone chronological timelines — the "through the seasons" view the
codebase already anticipates ([`sortChronological`](../../../src/lib/photos.ts)).
Each photo is classified by Claude Vision into an existing **zone** (or, when only
the region is identifiable, an **area**) using the yard's *permanent* hardscape
anchors, ignoring transient plants, tools, and later construction. The same
classify → review-queue pattern is established for future uploads.

Because the vision pass is a one-time, paid, sunk cost, the batch also captures a
rich enrichment payload per photo (caption, tags, hardscape milestones, botanical
detail) so the "narrate the evolution" layer can be built later without
re-processing any images.

## Context: what already exists

This is **not** a greenfield feature. The repo already has the relevant
infrastructure, which this design reuses rather than duplicates:

- **`zones`** table — 10 real zones with slug, name, polygon shape, and
  description. Eight are seeded (`hellstrip`, `foundation-bed`, `cedar-planters`,
  `pool-spa`, `dry-mineral-bed`, `front-raised-bed`, `north-side-yard`,
  `stock-tank`); two more (`Alley`, `Front Yard`) were added live via the editor.
  The live DB — not `seed-zones.mjs` — is the source of truth for the zone list.
- **`zone_photos`** table + a complete upload flow: signed-upload-URL
  ([`upload-url/route.ts`](../../../src/app/api/zone-photos/upload-url/route.ts)) →
  confirm-insert ([`confirm/route.ts`](../../../src/app/api/zone-photos/confirm/route.ts))
  → delete, with `taken_at` / `uploaded_at` and a `zone-photos` storage bucket.
- **`BaseMap.tsx`** — the survey-traced permanent hardscape (house, porch, A/C pad,
  patio, kidney pool, octagon spa, SE driveway, wood fence, property boundary,
  frontage parkway). This is the ground truth for the classifier's "anchors."
- **Service-role write / public-read RLS** pattern, and standalone `node` scripts
  under `scripts/` (e.g. `seed-zones.mjs`).

The original prompt (written without repo access) proposed a new `garden_photos`
table with a free-text `yard_zone` string and a live Google Photos API read. Both
are rejected here: we reuse `zone_photos` keyed to the structured `zones` table,
and the photos are already exported to a local folder (no Google Photos API — which
2025 restrictions would block for pre-existing albums anyway).

## Areas (the higher-level grouping)

The zones are fine-grained beds; a single historical photo often shows a broad
region or a bed that did not yet exist. A coarser **area** layer serves both as a
browse grouping and as the classifier's fallback ("I can tell it's the pool area
but not which planter").

Three areas, per the owner's mental model of the yard:

| Area | Covers |
|---|---|
| **Front** | North side by the A/C unit, everything under the oak tree, street-facing beds, the `Front Yard` zone |
| **Pool** | Pool, spa, patio, cedar planters |
| **South** | Along the driveway, raised beds, "the field," the vines |

Note the naming overlap: **`Front Yard` is a *zone*** that lives inside the
**`Front` *area***. Keep the two distinct in code (`zones.area = 'front'` for the
`Front Yard` zone).

**The giant Red Oak is the firm Front ↔ South demarcation** ("everything past the
Red Oak is South"), especially once the timeline reaches the Raised Bed Era. A
`Red Oak` text label has already been added to the map, so the anchor exists for
both humans and the classifier — no new map work is needed here.

Each zone is assigned to exactly one area (backfilled in the migration). A photo
resolved to a bed carries both `zone_id` and `area`; a photo resolved only to a
region carries `area` with `zone_id = NULL`.

## Architecture

### The review queue is the spine

Every photo lives in `zone_photos` with a `review_status`. Producers write rows;
a reviewer confirms or reassigns. Public read shows only `confirmed`. Phase 1
seeds the queue from the batch (high-confidence zone matches auto-confirm; the
rest land as `pending`). Phase 2's live uploads and phone-sync feed the **same**
queue via the same shared classifier — one mechanism, multiple producers.

### Schema — migration `0005_photo_classification.sql`

**`zones`:**
- Add `area text` with a check constraint (`front | pool | south`). Backfill all
  10 zones (mapping refined during implementation; ambiguous cases —
  `dry-mineral-bed`, `stock-tank`, and the new `Alley` — placed explicitly, with
  the `Front Yard` zone assigned to the `front` area).

**`zone_photos`:**
- `zone_id` → make **nullable** (area-only photos have no bed).
- Add core, queryable columns:
  - `area text` (nullable)
  - `review_status text not null default 'confirmed'`
    `check (review_status in ('pending','confirmed','rejected'))`
  - `source text not null default 'manual'`
    `check (source in ('manual','batch_import','phone_sync'))`
  - `source_ref text` — original filename or content hash; used to skip
    already-imported photos on a re-run (idempotency). Unique index where
    `source_ref is not null`.
  - `ai_zone_slug text`, `ai_area text`, `ai_confidence numeric`, `ai_model text`
  - `caption text`
  - `is_yard boolean` — junk gate
- Add `ai_meta jsonb not null default '{}'` — the flexible "sub-bucket" for
  exploratory enrichment: `quality`, `hardscape` (milestone flags), `botanical`
  (`bloom_colors`, notes), `plants` (see below), `tags`, `time_of_day`, `weather`,
  `reasoning`, and any field added later. Queryable via jsonb operators; promote a
  field to a real column only if it earns it.
- **`plants` is its own preserved category.** A photo may surface many plant tags;
  they are kept as a distinct `ai_meta.plants` array (separate from
  `botanical`/`tags`) and are **never pruned or deduplicated away** — the full list
  is retained. This keeps the door open to later linking detected plants against the
  existing `plant_catalog` table without a re-run.

**RLS:** tighten the public-read policy on `zone_photos` to
`review_status = 'confirmed'`. Existing manual photos default to `confirmed`, so
nothing regresses; unreviewed imports stay private until confirmed.

**Defaults note:** `default 'confirmed'` / `default 'manual'` preserve the current
manual upload flow untouched. The batch script sets `source` and `review_status`
explicitly.

### Shared classifier — `src/lib/zone-classifier.ts`

The single source of truth for classification, used by the batch now and the live
path later.

- **System prompt:** strict classifier grounded in the permanent anchors from
  `BaseMap.tsx` (one-story brick house + siding/windows, covered porch on the west,
  A/C pad + shed to the north, concrete patio between house and pool, kidney pool +
  octagon spa, SE concrete driveway to the alley, wood fence, property boundary
  curve, frontage parkway/sidewalk) **plus the giant Red Oak as the Front/South
  divider**. Enumerates the zones with their area. Explicit instruction to ignore
  transient foreground (plants, seasonal change, tools, and hardscaping added over
  time — the stock tank, raised beds, vines, cedar planters — since those are the
  *changes* we are dating, not anchors).
- **Output schema (structured outputs / `output_config.format`):**

  ```json
  {
    "is_yard": true,
    "quality": "good | ok | poor",
    "area": "front | pool | south | null",
    "zone_slug": "<one of the enumerated slugs> | null",
    "confidence": 0.0,
    "reasoning": "short",
    "caption": "one descriptive sentence",
    "tags": ["..."],
    "hardscape": {
      "stock_tank": false,
      "raised_beds": false,
      "vines": false,
      "cover_crop_field": false,
      "cedar_planters": false
    },
    "plants": ["..."],
    "botanical": {
      "bloom_colors": ["..."],
      "notes": "exploratory"
    }
  }
  ```

  `plants` is deliberately its own top-level array (not nested under `botanical`)
  to signal it is a preserved, potentially-long category — see the schema note
  above. The classifier is told to list every plant it can identify and not to
  self-limit the count.

- **`classifyImage()`** — wraps a single real-time Messages API call returning the
  above; the live path (Phase 2) calls this directly.
- **Model:** `claude-sonnet-4-6`. Chosen over Haiku for higher one-shot accuracy on
  anchor-based reasoning past transient clutter; over Opus as right-sized for
  classification. Batch pass ≈ $9 one-time at the 50% discount.

### Migration script — `scripts/import-photos.mjs`

Standalone `node` script (matches the existing `scripts/` convention), run against
the local export folder. Pipeline:

1. **Walk** the local JPEG folder (recursively).
2. **Capture date** per photo: EXIF `DateTimeOriginal` → filename pattern fallback
   (e.g. `IMG_20240615`) → file mtime as last resort. Record which source was used.
3. **Downscale** with **sharp**:
   - Transient API copy: 1568px long edge, JPEG q~80 (Sonnet downsamples past
     ~1568px, so larger is wasted tokens).
   - Stored display copy: **1280px long edge, JPEG q75 (~180 KB)**, EXIF stripped.
4. **Build JSONL** for the Batches API — one request per photo, `custom_id` keyed
   to `source_ref`, system prompt + base64 image, structured-output format on.
5. **Submit** the batch, **poll** to completion (results retained 29 days).
6. **On results:** for each succeeded result, upload the stored display copy to the
   `zone-photos` bucket and insert a `zone_photos` row (`source = 'batch_import'`,
   core AI columns + `ai_meta`). `is_yard = false` → skip insert (or insert with a
   flag, TBD in plan). High-confidence zone match → `review_status = 'confirmed'`;
   low-confidence or area-only → `pending`.
7. **`--dry-run`** — steps 1–5 plus writing a CSV/JSON of proposed classifications
   with **no DB or storage writes**, so accuracy and the confidence threshold can
   be tuned before committing.

**Error handling:**
- **Partial batch failures** — iterate results by `custom_id`; log and skip
  `errored`/`expired` entries, continue the rest. Re-running only re-imports the
  missing ones (via `source_ref`).
- **Missing EXIF** — the filename → mtime fallback chain; record the source so
  low-confidence dates are visible.
- **Idempotency** — `source_ref` unique index; skip photos already imported.
- **Storage guard** — track cumulative uploaded bytes; warn as the 1 GB tier is
  approached.

**Archival note:** the 13.9 GB of originals do not fit the free tier. The local
folder is the archival master (the owner should back it up); Supabase holds only
the ~180 KB display copies (~550 MB for the full set, ~450 MB headroom).

## Phase boundaries

**Phase 1 (this spec — shippable):**
- `0005_photo_classification.sql`
- `src/lib/zone-classifier.ts`
- `scripts/import-photos.mjs` (with `--dry-run`)

(The Red Oak map anchor already exists — added live as a `Red Oak` text label —
so it is not a deliverable here.)

Outcome: photos classified and imported; high-confidence beds confirmed, the rest
queued as `pending`; rich `ai_meta` captured for the whole set.

**Phase 2 (noted, not built now):**
- Frontend review-queue UI (confirm / reassign pending photos)
- Phone-sync auto-processing into the queue
- Real-time `classifyImage()` on live uploads (suggest-and-confirm)
- A text-only "narrative" second pass that synthesizes `ai_meta` into per-zone /
  per-season prose and auto-detected "eras" (first appearance of each hardscape
  milestone, sorted by `captured_at`)

All Phase 2 work reuses the Phase 1 classifier lib and the same queue/status model.

## Non-goals

- No Google Photos API integration (photos already exported; API is restricted).
- No new `garden_photos` table (reuse `zone_photos`).
- No thumbnail generation now — one stored size; Next.js `<Image>` resizes per
  viewport.
- No review UI in Phase 1 (the `--dry-run` CSV is the Phase 1 accuracy check).

## Open items for the implementation plan

- Exact zone → area backfill mapping for all 10 zones, including the ambiguous
  `dry-mineral-bed`, `stock-tank`, and `Alley`, and confirming `Front Yard` → `front`.
- Whether `is_yard = false` photos are skipped entirely or inserted with a flag.
- The confidence threshold that separates auto-`confirmed` from `pending`
  (tuned against the `--dry-run` output on a sample).
- Google/EXIF library choice for reading `DateTimeOriginal` (e.g. `exifr`) vs.
  reading via sharp metadata.
