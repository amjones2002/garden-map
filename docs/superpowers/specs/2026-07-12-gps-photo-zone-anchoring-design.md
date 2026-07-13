# GPS-Anchored Photo Zone Classification — Design

**Date:** 2026-07-12
**Status:** Approved (design); implementation plan pending

## Goal

The photo classifier ([`classify/route.ts`](../../../src/app/api/zone-photos/classify/route.ts)
+ [`zone-classifier.mjs`](../../../src/lib/zone-classifier.mjs)) misclassifies at the
**area** level: roughly half of one south bed's pending photos are actually
Front/South confusions, and about a third of "Front Yard"-confirmed photos are
really South. Vision alone can't reliably separate front-yard beds from south beds
— they're both "a garden bed with plants," and the Red Oak divider anchor already
in the prompt isn't enough. There are **~992 photos waiting to review** plus a set
of already-auto-tagged photos that need re-running.

This design anchors classification to the one signal that *does* separate the areas
— the **camera's GPS coordinates**, which every photo carries in EXIF — and closes
the tracking gap so that human corrections accumulate into a clean, queryable
training set for an ongoing text-lesson feedback loop.

Approach **C (staged)**:

- **Phase 1 — GPS area-prior.** Read each photo's GPS, map it (via a data-driven
  georeference) to an **area** and a shortlist of nearby beds, and hand that to the
  classifier as a strong prior. GPS decisively fixes the Front↔South error and
  rescues the backlog.
- **Phase 2 — text-lesson hints + close-up handling.** Distill human corrections
  into short written disambiguation notes injected into the classifier prompt;
  auto-defer genuinely-ambiguous close-ups to the human. This is the "train the
  model ongoing" the owner asked about — no fine-tuning, no per-call image cost,
  just cheap prompt-level feedback that compounds as the backlog is reviewed.

## Context: what already exists

Reused rather than rebuilt:

- **`zone_photos`** already keeps the AI's guess in separate columns
  (`ai_zone_slug`, `ai_area`, `ai_confidence`, `ai_model`, `ai_meta`) from the
  human-final `zone_id`/`area`. Review actions preserve them —
  [`planReviewUpdate`](../../../src/lib/zone-photos-review.ts) patches only
  `review_status`/`zone_id`/`area`, never the `ai_*` columns. **The raw
  agreement/disagreement signal already survives; it just isn't explicit or
  timestamped.**
- **`source_ref`** — the original filename / content hash, with a unique index
  ([migration 0005](../../../supabase/migrations/0005_photo_classification.sql)).
  This is the **join key** between the local original files and their DB rows,
  which the one-time GPS backfill depends on.
- **EXIF is already read client-side** before upload —
  [`getExifDateTaken`](../../../src/lib/exif.ts) uses `exifr` on the `File` prior to
  the server-side `sharp` downscale (which strips EXIF). GPS lives in the same EXIF
  block; `exifr.gps(file)` returns `{ latitude, longitude }` as a one-liner. No new
  dependency, and the strip-on-downscale problem is already avoided.
- **Zones are polygons in normalized `0..1` map space** (`zones.shape` =
  `[{x,y},…]`, [migration 0001](../../../supabase/migrations/0001_init.sql)) — an
  abstract map coordinate system, **not** lat/lng. Mapping GPS → zone therefore
  requires a one-time georeference (below).
- **The Red Oak Front/South divider** is already in the classifier system prompt
  and as a map label. GPS *complements* it — it doesn't replace the anchor-based
  reasoning, it grounds it.
- **Shared classifier + standalone `scripts/` convention** (e.g.
  `import-photos.mjs`) — the backfill script follows the same pattern.

## Data model — capture the signal properly

Migration `0007_photo_gps_and_review_provenance.sql` (0006 exists), adding to
`zone_photos`:

| Column | Type | Purpose |
|---|---|---|
| `gps_lat` | `numeric` | Camera latitude from EXIF (nullable — not every photo has a fix). |
| `gps_lng` | `numeric` | Camera longitude. |
| `gps_accuracy` | `numeric` | EXIF `GPSHPositioningError` in metres when present; else null. |
| `reviewed_at` | `timestamptz` | When a human acted on the row (null = never reviewed). |
| `review_action` | `text` | `confirmed_asis` / `reassigned` / `rejected`, check-constrained; null until reviewed. |

Index `gps_lat, gps_lng` (partial, where not null) for the georeference fit query.

With the existing `ai_*` columns, every row now records: **what the AI guessed,
where the camera was, what the human decided, and whether that was a correction.**
That is the training set — no reconstruction, no separate table.

`review_action` is written by the review route
([`review/route.ts`](../../../src/app/api/zone-photos/review/route.ts) →
[`planReviewUpdate`](../../../src/lib/zone-photos-review.ts)): `reject` →
`rejected`; `confirm`/`reassign` → `confirmed_asis` if the chosen `zone_id`
matches the AI's `ai_zone_slug`, else `reassigned`. `reviewed_at = now()`.

**Trust distinction:** only **human-reviewed** rows (`review_action` set) are
trustworthy labels. Auto-confirmed rows (high AI confidence, never human-checked)
are *not* — the owner is already seeing many wrong. The georeference fit and the
Phase 2 exemplar pool both draw **only** from `review_action IS NOT NULL` rows.

## Phase 1 — GPS area-prior

### 1. Read GPS from EXIF

Extend [`exif.ts`](../../../src/lib/exif.ts) with `getExifGps(file)` →
`{ lat, lng, accuracy } | null` via `exifr.gps()` / `exifr.parse(file,
['GPSHPositioningError'])`. Called in [`UploadTab`](../../../src/app/photos/UploadTab.tsx)
alongside the existing date read; the coordinates flow through the confirm insert
into the new columns.

### 2. One-time GPS backfill + auto-tag re-run

Standalone `scripts/backfill-photo-gps.mjs` (matches `import-photos.mjs`):

1. Walk the **local original** folder (the same export used for the batch import).
2. For each file, read GPS with `exifr`.
3. Match to its `zone_photos` row by `source_ref` (= original filename).
4. `UPDATE` the row's `gps_lat`/`gps_lng`/`gps_accuracy`.
5. `--dry-run` reports coverage (how many rows got a fix) with no writes.

This attaches GPS to the whole existing corpus — the 992 pending **and** the
auto-tagged — from the local files, so no re-upload is needed. The go-forward path
(step 1) captures GPS at upload time.

**Re-running the auto-tagged photos:** once GPS is attached and the georeference is
fit (below), a pass recomputes each non-human-reviewed photo's **area** (and a
suggested zone) directly from GPS via point-in-polygon — **no paid vision call
needed** for the area fix, since GPS *is* the area signal. Photos whose GPS-derived
area disagrees with their stored `ai_area` are flipped back to `pending` for
review. Vision re-classification is reserved for genuinely ambiguous cases (below).

### 3. Georeference — data-driven affine fit

Map GPS `(lat, lng)` → normalized map `(x, y)` with a **2×3 affine transform**
(absorbs the plot's rotation-off-north, independent lat/lng scale, and translation
in one fit; the small lat/lng aspect distortion over a 0.25-acre plot is absorbed
by the independent x/y scales).

- **Control points:** each **human-reviewed** photo with GPS contributes one pair —
  its `(lat, lng)` against its zone's **polygon centroid** in map space. Fit by
  least squares.
- **Bootstrap threshold:** the transform activates only with **≥ N control points
  spanning ≥ 3 distinct zones** that are spread across the plot (guarding against a
  degenerate colinear fit). Until then, classification falls back to the current
  **vision-only** path — **no regression**, just no GPS benefit yet.
- **Self-refining:** every new human confirmation adds a control point; the
  transform is re-fit and stored (a small `map_georeference` config row, or a cached
  JSON the classify route reads). Accuracy climbs as the backlog is reviewed — the
  compounding the owner wanted.
- Store the fit's **residual RMS** (in metres) as a health signal; a large residual
  means bad labels or a bad fit and should surface rather than silently mislead.

**Bootstrap rollout:** to activate GPS quickly, the owner reviews a first ~10–15
photos spread across the yard (a few per area). That seeds the transform; from
there the prior is live for the remaining ~977.

### 4. GPS prior in the classifier

In [`classify/route.ts`](../../../src/app/api/zone-photos/classify/route.ts), when a
photo has GPS **and** the transform is active:

1. Transform GPS → map point.
2. Point-in-polygon against `zones.shape` → the containing zone, or (if the point
   falls between beds, expected given GPS error) the **nearest zones within a radius
   scaled by `gps_accuracy`**.
3. Derive the **area** and a **ranked shortlist of candidate beds**.
4. Inject into the system prompt as a strong prior:
   *"The camera's GPS places this photo in the **south** area, near these beds:
   `raised-bed`, `dry-mineral-bed`. Choose the bed from this shortlist unless the
   image clearly shows a different, named area."*

**Soft, not hard.** GPS sets the **area** with high weight (areas are 10–20 m+
apart, well outside GPS error) but the model may override *only* with high
confidence and explicit reasoning — e.g. a photo shot *across* the yard from the
south toward the pool. The bed within the area is the model's call, informed by the
shortlist. Photos with no GPS fix use the unchanged vision-only path.

## Phase 2 — text-lesson hints + close-up handling

*(Noted, not built in Phase 1. Reuses the same classifier and queue.)*

Human corrections are distilled into short **written disambiguation notes** injected
into the classifier prompt, so the next classification avoids the repeat mistake.
Chosen over few-shot *image* exemplars deliberately: image exemplars add ~1,600
tokens **per exemplar per photo** to every classify call, whereas the entire text-
lesson block is a few hundred tokens sent once — and prompt-cacheable on the live
route (see Cost model). Legible and directly editable, which suits a single owner
who knows the ground truth.

**Two homes in the prompt** — both already flow through `buildSystemPrompt(zones)`:

- **Per-zone tells** — appended to each zone's existing `description` column ("how to
  recognize *this* bed": *"cedar-planters — raised cedar boxes against the pool-side
  brick wall; pool usually visible in frame"*). No new storage; edited in the
  existing zone editor.
- **A global "Common confusions" block** — the pairwise tie-breakers, and where the
  Front↔South fix lives *in text*, complementing the GPS prior: *"Front vs South:
  everything past the Red Oak is South; Front beds face the street and show the brick
  facade/hedge, South beds run along the driveway/fence."* Stored as a single
  maintained `classifier_notes` value (config row or repo markdown the prompt reads).

**The ongoing loop (the "train the model" the owner wanted):**

1. **Seed now, by hand** — write the Front↔South tells and anchor cues already known
   (wide shots easy, close-ups hard, Red Oak divider, hardscape landmarks). Immediate
   lift, no accumulated data required.
2. **Capture at review** — an optional one-line *"why was the AI wrong?"* note on
   reassign/reject, stored on the row (`review_note`, or under `ai_meta`). Raw
   material; never required.
3. **Distill periodically (optional LLM-assist)** — a small pass clusters recent
   corrections by confused-pair (`ai_zone_slug` ≠ final `zone_id`) and **drafts**
   candidate note edits for the owner to approve/edit. The human stays in the loop —
   nothing auto-injects an unverified tell.

*Recommended sequencing: manual seed + capture-at-review first; add the LLM-drafting
assist only if correction volume justifies it.*

- **Close-up detection.** The output schema gains `framing: "closeup" | "context"`.
  A `closeup` photo with low confidence and no decisive GPS bed is **auto-deferred**
  to `pending` rather than guessed — matching the owner's observation that
  zoomed-in plant shots are hard even for a human, while anything wider is easy.
- **Image exemplars — rare escalation only.** Confirmed exemplar images (from
  `review_action IS NOT NULL` rows) are kept as a targeted fallback for a bed that
  text genuinely can't describe — *not* the default, given the per-call token cost.

## Cost model

The one-time Vision batch already ran: **$34.29** (not the ~$9 the earlier pipeline
spec estimated). The gap was the ~3,400-token system prompt billed **uncached on
every one of ~3,000 batch requests** — the Batch API shares no prompt cache
(`cache_read`/`cache_write` were zero on the invoice) — plus ~500 tokens/photo of
verbose enrichment output. This shapes the design:

- **The GPS area re-run costs ≈ $0.** It is point-in-polygon geometry, *not* a Vision
  call — correcting Front↔South across the whole corpus adds nothing to the bill.
- **Text lessons ≈ free.** A few hundred tokens once per call, versus image
  exemplars' ~1,600 tokens each — the reason Phase 2 favors text.
- **Any future at-scale Vision re-run should use the live route with prompt caching,
  not batch.** `cache_control` on the zone-enumeration system block cuts the repeated
  ~3,400-token prefix to ~10% on cache hits; for a large shared prompt, cached live
  calls beat the Batch API's flat 50% discount (the same run cached would have been
  ~$10–12).

## Phase boundaries

**Phase 1 (this spec — shippable):**
- `0007_photo_gps_and_review_provenance.sql`
- `getExifGps` in `exif.ts` + wiring in `UploadTab`
- `review_action`/`reviewed_at` written in the review route
- `scripts/backfill-photo-gps.mjs` (`--dry-run`)
- Georeference fit (module + stored transform + activation threshold)
- GPS prior injected in `classify/route.ts`
- GPS-based area re-run of auto-tagged photos

Outcome: GPS attached to the full corpus; Front↔South area errors corrected;
per-photo provenance recorded; the transform live and self-refining.

**Phase 2 (noted, not built now):**
- `framing` flag + close-up auto-deferral
- Text-lesson hints: seed per-zone tells + a `classifier_notes` "Common confusions"
  block; capture-at-review notes; optional LLM-assisted distillation
- (Optional) confirmed-image exemplars as a rare escalation only
- (Optional) an accuracy view over `review_action` — trivial once the column exists

## Non-goals

- **No model fine-tuning / no separate ML model.** The classifier stays a Claude
  vision prompt; "ongoing training" = prompt-level feedback (GPS prior + text-lesson
  hints).
- **No image few-shot exemplars by default.** Ruled out on cost (~1,600 tokens per
  exemplar per call); text lessons are the Phase 2 mechanism, images a rare fallback.
- **No accuracy dashboard now.** The `review_action` column makes one a later
  formality if wanted.
- **No new table** — extend `zone_photos`; the transform is a small config row/JSON.
- **No manual georeference UI.** The fit is data-driven per the owner's choice; a
  manual control-point entry is out of scope unless the data-driven bootstrap
  proves insufficient.

## Open items for the implementation plan

- The bootstrap threshold **N** and the "spread across ≥3 zones" spatial test, and
  the residual-RMS ceiling that flags a bad fit.
- GPS-error radius → candidate-shortlist mapping (how many beds, how far).
- The confidence bar at which vision may **override** the GPS-implied area.
- Where the fitted transform lives (a `map_georeference` row vs. cached JSON) and
  when it re-fits (every confirmation vs. batched).
- Whether the auto-tag re-run flips *all* GPS-area-disagreeing photos to `pending`
  or only those past a distance/confidence margin.
- Confirming `source_ref` holds the exact local filename for every existing row
  (the backfill join); fallback to content-hash matching if not.
- `exifr` GPS field coverage across the real corpus (the `--dry-run` coverage report
  quantifies how many photos actually carry a fix before committing).
- Where the global `classifier_notes` lives (config row vs. repo markdown) and where
  the capture-at-review note is stored (`review_note` column vs. `ai_meta`) — both
  Phase 2, but named here so Phase 1's schema leaves room.
