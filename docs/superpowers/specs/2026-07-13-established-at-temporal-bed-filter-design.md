# `established_at` Temporal Bed Filter — Design

**Date:** 2026-07-13
**Status:** Approved (design); implementation in progress
**Depends on:** GPS photo-zone anchoring Phase 1 (merged `main`, PRs #22/#23:
schema `0007`, `src/lib/georeference.mjs`, GPS area prior in the classify route).

## Goal

Photos span 2024-10 → 2026-07, but the beds in this yard were built at various
points across that window. When the classifier or a human reviewer assigns a
photo to a bed, it should only be offered beds **that already existed when the
photo was taken**. A photo from 2024-11 must never be tagged to a raised bed
built in 2025-05 — that bed does not physically appear in the frame.

The fix: give each bed an `established_at` date and filter bed candidates by
`photo.taken_at >= established_at` at every surface that offers beds.

**Areas are time-stable** (front / pool / south have always existed), so the GPS
**area** prior is unaffected — this change only touches the **bed** step.

## Non-goals (YAGNI)

- **No `removed_at`** — beds removed over time are not modeled. Deferred.
- **No blind bulk backfill** of the 2,884 already-classified photos. Measurement
  (see "Backfill exposure") shows the existing *confirmed* bed tags are clean.
  Instead we ship an **audit script** that, once real dates are entered, lists any
  confirmed photo whose `taken_at` predates its bed's `established_at`. The thin
  residual set (if any) is reassigned by hand in the ReviewTab.
- **No batch-import changes.** `buildSystemPrompt` / `buildClassificationSchema`
  already accept a zone list, so a future batch re-run just passes a filtered list.
- **No new data-entry UI.** Dates are hand-entered into a migration, aided by a
  hint script.

## Context: how beds are offered today

- **Live classify route** (`src/app/api/zone-photos/classify/route.ts`) fetches
  *all* zones, builds the system prompt and the JSON-schema `zone_slug` enum from
  them, and derives a GPS bed shortlist via `resolveGpsHint`. The model may return
  any bed slug.
- **`resolveGpsHint`** (`src/lib/georeference.mjs`) does two jobs: pick the **area**
  (from the nearest zone centroid) and build a nearest-bed **shortlist**.
- **ReviewTab** (`src/app/photos/ReviewTab.tsx`) — the per-thumb reassign dropdown
  and the `AreaOnlyBucket` dropdown offer *every* zone (`sortZonesByName(zones)`).
- **UploadTab** (`src/app/photos/UploadTab.tsx`) — the manual zone dropdown offers
  every zone; the client already computes each item's `taken_at` via
  `getExifDateTaken` before calling classify.
- **Zones** carry `area` (`front|pool|south`). `established_at` is new.

## Backfill exposure (measured 2026-07-13)

Per active bed, confirmed-photo counts before 2025:

- Every **young** bed (built mid-record) has its earliest *confirmed* photo already
  late and **zero** confirmed photos before 2025: stock-tank (2025-04-13),
  cedar-planters (2025-04-15), the-field (2025-04-17), front-street-beds
  (2025-04-21), front-raised-bed / field-bed-vines (2025-05-04), dry-mineral-bed
  (2025-05-08).
- Every bed that *does* hold pre-2025 confirmed photos — front-yard, foundation-bed,
  front-house-beds, north-side-yard, pool-spa, alley, driveway, hellstrip — is
  exactly the set that **predates the photo record** (→ `established_at` stays null).

Conclusion: the batch + human review left confirmed bed tags clean. The only
residual risk is per-bed and narrow — confirmed photos falling between a young
bed's earliest-confirmed date and its *true* `established_at` (knowable only once
dates are entered). The audit script surfaces exactly those.

## Design

### 1. Schema — migration `0008_zone_established_at.sql`

```sql
alter table zones add column established_at date;
```

Nullable. **Null = "existed before the photo record / permanent" → never filtered
out.** The real per-bed dates are added as `update zones set established_at = '…'
where slug = '…'` statements in the same migration, filled in after the dates are
gathered. Beds that predate the record stay null.

`Zone` type (`src/lib/types.ts`) gains `established_at: string | null`.

### 2. The pure primitive — `bedsAvailableAt(zones, takenAt)`

In `src/lib/zones.ts`. Returns the subset of `zones` available at photo time:

```
established_at == null  → included (permanent / predates record)
takenAt == null         → all included (undatable photo — don't hide the answer)
takenAt >= established_at → included
otherwise               → excluded
```

Comparison is on the **calendar date** (`established_at` is a plain date; `taken_at`
is a timestamptz — compare `taken_at`'s date). Month-precision dates make boundary
fuzz immaterial. One well-bounded, unit-tested function reused by every surface.

**Two judgment calls (locked):**
- **Null `taken_at` → offer all beds.** We can't date the photo, so we don't hide
  the correct answer.
- **Hard exclusion, not a soft nudge.** The bed is removed from the schema enum and
  the dropdowns — the model literally cannot emit it. Safe because dates are
  month-precision, null-established beds always show, and the worst case of a
  slightly-wrong date is "photo falls back to area-only, human reassigns" — never
  data loss.

### 3. Consuming surfaces

**A. Live classify route** (`classify/route.ts`)
- The client sends `taken_at` in the classify request body (same value UploadTab
  already computed and will store at confirm — single source of truth). Absent →
  no filter.
- `availableZones = bedsAvailableAt(allZones, taken_at)` feeds `buildSystemPrompt`
  and `buildClassificationSchema`. Not-yet-existent beds disappear from both the
  prompt list and the `zone_slug` enum.

**B. GPS prior — area stability**
- `resolveGpsHint(geo, lat, lng, fullZonesGeo)` is still called with the **full**
  zone set so **area** detection stays correct (a young-bed-only area must still
  resolve to its area, not the nearest surviving zone elsewhere).
- The returned `shortlist` is then filtered to available slugs in the route.
  `gpsPriorText` already handles an empty shortlist (area, no beds).

**C. ReviewTab** (`ReviewTab.tsx`) — the reassign dropdown and the `AreaOnlyBucket`
dropdown are filtered **per thumb** by that photo's `taken_at`, so reviewing a 2024
photo never offers a 2025 bed.

**D. UploadTab** (`UploadTab.tsx`) — the manual zone dropdown filtered per item by
`it.takenAt`.

### 4. Hint script — `scripts/established-at-hints.mjs`

Prints one row per active zone: `slug · name · area · earliest confirmed photo ·
current established_at`, plus a **compact monthly count of confirmed photos** around
each bed's earliest date. The earliest-confirmed date is an upper bound on
`established_at`; the monthly counts show, at date-entry time, exactly how many
confirmed photos a chosen `established_at` would flag — no surprises. Loads
`.env.local` like the other scripts.

### 5. Audit script — `scripts/audit-established-at.mjs`

Run *after* dates are entered. Uses `bedsAvailableAt` over **confirmed** photos and
lists every confirmed photo whose `taken_at` predates its bed's `established_at`
(photo id, storage_path, bed, taken_at, established_at). Read-only — it reports;
correction is a manual ReviewTab reassignment. Given the measured exposure, this is
expected to be a handful at most.

## Testing

- `bedsAvailableAt` unit tests (`tests/zones.test.ts`): null `established_at` →
  included; null `takenAt` → all included; `takenAt` before / on / after
  `established_at` (same-day boundary); mixed set.
- A prompt/schema-level check that a bed with a future `established_at` is absent
  from the enum built by `buildClassificationSchema` for an early photo.

## Rollout

1. Migration `0008` (column only, no dates yet) → `bedsAvailableAt` + wiring →
   tests green.
2. Run the hint script; gather the ~8 real dates (young beds; the rest stay null).
3. Add the `update` statements to `0008`, apply.
4. Run the audit script; reassign any flagged confirmed photos by hand.
