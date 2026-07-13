# GPS-anchored classification — Phase 1 operational rollout

Runbook for taking Phase 1 (GPS area-prior) live against production Supabase.
All scripts load `.env.local` from the repo root (copy it into a worktree if
you run from one — it is gitignored).

## Status (2026-07-12)

- [x] **1. Migration applied** — `0007_photo_gps_and_review_provenance.sql`.
- [x] **2. GPS backfill run** — `--dir "C:/Users/amjon/Downloads/Garden-2-001/Garden"`.
      2884 rows updated. Files scanned 3038, with GPS 3027 (99.6%), 11 no-fix,
      143 GPS files with no matching DB row (extra local files not imported).
- [ ] **3. Seed review** — review ~15 spread-out photos (see seed set below).
- [ ] **4. Fit** — `node scripts/fit-georeference.mjs --dry-run` then real.
- [ ] **5. Re-run areas** — `node scripts/rerun-area-from-gps.mjs --dry-run` then real.

## Data findings from the backfill

### GPS distribution (2884 geotagged rows)

- **98.4% (2837) sit within 100 m of the plot center** (median
  `32.933516, -96.685232`). Tight-cluster spread: p50 15 m, p90 24 m, p99 31 m,
  max 76 m — consistent with a 0.25-acre plot plus normal phone-GPS jitter.
- **~52 outliers** lie beyond 50 m; 12 are 1–5 km away and one is 6.9 km
  (photos shot off-site, or wild fixes). These must be excluded from the fit.
- `gps_accuracy` (EXIF `GPSHPositioningError`) is **null on every row**, so
  outliers can only be caught geographically, not by a reported-accuracy field.

**Implication:** GPS separates the ~10–20 m *areas* (front / south / field) but
not individual beds — exactly the Phase 1 premise. Per-photo jitter (~15 m) is
comparable to area spacing, so expect a usable-but-noisy area prior, not a
bed-level one.

**Fix applied:** `filterPlotOutliers()` (in `src/lib/georeference.mjs`) drops
control points >100 m from the median center; `fit-georeference.mjs` calls it
before `fitAffine`, so a stray off-site review can no longer wreck the fit.

### Duplicate manual uploads (18 null-`source_ref` rows) — decision pending

The 18 rows with `source_ref IS NULL` are early `manual` app uploads. Perceptual
-hash check (dHash) against the local originals:

- **14 are exact duplicates** (distance 0) of a photo already in the DB that has
  a `source_ref` and GPS — the same June-2026 images uploaded manually, then
  swept in again by the bulk import. The batch twin is the canonical copy.
  - **4 of these 14 were hand-tagged to a different zone than their twin**
    (`2b4323df`, `4c6d5a39`, `6e6478de`, `2bf02c49`) — reconcile the label
    before deleting.
- **4 are NOT duplicates** (`5b226b3a`, `17a7ab0b`, `124ea891`, `033fc687`) —
  genuine one-offs whose originals aren't in the Garden folder. Keep them; they
  can get GPS from their stored full-res EXIF.

No rows were deleted — deletion is a manual decision.

## Seed set for step 3

15 photos chosen by farthest-point (max-min) sampling over the 2832 on-plot
inliers (outliers excluded), min spacing 14.4 m, spanning 8 AI zones across
front + south. Review each in the app (confirm or reassign) to stamp its GPS
control point.

Visual worksheet (spread map + thumbnails + coords + links):
<https://claude.ai/code/artifact/0da2fa35-0cf6-4a97-847b-ea3c55c34b7f>

The fit needs **≥8 confirmed photos across ≥3 distinct zones** before
`fit-georeference.mjs` writes a transform; 15 gives margin for close-ups you
reject on review.

## Commands

```bash
# 2. Backfill (already done) — re-run is idempotent
node scripts/backfill-photo-gps.mjs --dir "<originals-root>" --dry-run
node scripts/backfill-photo-gps.mjs --dir "<originals-root>"

# 4. Fit the transform from human-reviewed GPS photos
node scripts/fit-georeference.mjs --dry-run   # reports n, rms, outliers dropped
node scripts/fit-georeference.mjs

# 5. Re-derive area for non-human-reviewed rows from GPS
node scripts/rerun-area-from-gps.mjs --dry-run   # check 'reopened' count
node scripts/rerun-area-from-gps.mjs
```
