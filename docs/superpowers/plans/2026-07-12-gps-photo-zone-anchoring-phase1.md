# GPS-Anchored Photo Zone Classification — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor the photo classifier to camera GPS so it stops confusing the Front and South areas, and record per-photo review provenance so corrections become a clean training signal.

**Architecture:** A one-time affine georeference (fitted from human-reviewed GPS-tagged photos) maps a photo's EXIF GPS to a map area + a shortlist of nearby beds, injected into the Vision system prompt as a strong prior. GPS is read client-side on new uploads and server-side in the classify route; a backfill script attaches GPS to the existing corpus from the local originals, and a re-run script corrects areas from GPS with no Vision call. All geometry/math lives in one pure module.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + storage, service-role writes), `@supabase/supabase-js`, `@anthropic-ai/sdk`, `exifr`, `sharp`, standalone Node `scripts/`, Vitest.

## Global Constraints

- **This is a non-standard Next.js build** — read the relevant guide in `node_modules/next/dist/docs/` before writing route/framework code; APIs may differ from training data (per `AGENTS.md`).
- **Writes go through the service role.** Server routes use `getServerSupabase()` ([src/lib/supabase/server.ts]); RLS blocks anon writes. Scripts use `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.
- **Shared code that both a `.ts` route and a `.mjs` script import must be `.mjs`** (see `src/lib/zone-classifier.mjs`). Pure geometry is `.mjs` for this reason.
- **Zone shapes are normalized `0..1` map coordinates** (`zones.shape` = `{x,y}[]`), NOT lat/lng.
- **`source_ref`** = POSIX-relative path from the import root (`scripts/lib/photo-file.mjs → sourceRefFor`). The GPS backfill must reuse the same root and helper to match rows.
- **Only human-reviewed rows are trustworthy labels** (`reviewed_at IS NOT NULL`). The georeference fit draws only from these; the area re-run only touches rows where `reviewed_at IS NULL`.
- **Tests:** `npm test` (vitest run). Test files live in `tests/`, import from `../src/...`.
- **Commit** after each task's tests pass.

---

## File Structure

- `supabase/migrations/0007_photo_gps_and_review_provenance.sql` — **create.** GPS + provenance columns on `zone_photos`, indexes, and the `map_georeference` singleton table.
- `src/lib/types.ts` — **modify.** Extend `ZonePhoto`; add `ReviewAction` stored-value type.
- `src/lib/georeference.mjs` — **create.** Pure geometry + affine fit + GPS→hint resolution.
- `src/lib/exif.ts` — **modify.** Add `parseGps` (pure) + `getExifGps` (File wrapper).
- `src/lib/zone-photos-write.ts` — **modify.** Thread `gps_lat/gps_lng/gps_accuracy` through `buildConfirmRow`.
- `src/app/photos/UploadTab.tsx` — **modify.** Read GPS on upload, persist via confirm.
- `src/lib/zone-photos-review.ts` — **modify.** `planReviewUpdate` emits `review_action`.
- `src/app/api/zone-photos/review/route.ts` — **modify.** Stamp `reviewed_at`.
- `src/lib/zone-classifier.mjs` — **modify.** Add `gpsPriorText`.
- `src/app/api/zone-photos/classify/route.ts` — **modify.** Read GPS from the blob, resolve the hint, append the prior.
- `scripts/fit-georeference.mjs` — **create.** Fit the transform from human-reviewed GPS photos; upsert `map_georeference`.
- `scripts/backfill-photo-gps.mjs` — **create.** Attach GPS from local originals to existing rows (`--dry-run`).
- `scripts/lib/area-rerun-core.mjs` — **create.** Pure `planAreaRerun`.
- `scripts/rerun-area-from-gps.mjs` — **create.** Re-derive area from GPS for non-human-reviewed rows (`--dry-run`).
- Tests: `tests/georeference.test.ts`, `tests/exif-gps.test.ts`, `tests/zone-photos-write.test.ts` (extend), `tests/zone-photos-review.test.ts` (extend), `tests/zone-classifier-gps.test.ts`, `tests/area-rerun.test.ts`.

---

### Task 1: Schema — GPS + review provenance + georeference table

**Files:**
- Create: `supabase/migrations/0007_photo_gps_and_review_provenance.sql`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces columns on `zone_photos`: `gps_lat numeric`, `gps_lng numeric`, `gps_accuracy numeric`, `reviewed_at timestamptz`, `review_action text` (`confirmed_asis|reassigned|rejected`).
- Produces table `map_georeference` (singleton `id=1`) with affine coeffs `a..f double precision`, `n_points int`, `rms double precision`, `fitted_at timestamptz`.
- Produces TS: `ZonePhoto` gains `gps_lat/gps_lng/gps_accuracy: number | null`, `reviewed_at: string | null`, `review_action: ReviewAction | null`; new `export type ReviewAction = "confirmed_asis" | "reassigned" | "rejected"`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_photo_gps_and_review_provenance.sql`:

```sql
-- Phase 1: camera GPS + human-review provenance on zone_photos, and a
-- singleton georeference transform (lat/lng -> normalized 0..1 map space).

-- 1) GPS + PROVENANCE ON ZONE_PHOTOS ---------------------------------------
alter table zone_photos
  add column if not exists gps_lat numeric,
  add column if not exists gps_lng numeric,
  add column if not exists gps_accuracy numeric,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_action text
    check (review_action is null
           or review_action in ('confirmed_asis','reassigned','rejected'));

-- Georeference-fit query path (human-reviewed rows that carry a fix).
create index if not exists zone_photos_gps_idx
  on zone_photos (gps_lat, gps_lng) where gps_lat is not null;

-- 2) GEOREFERENCE TRANSFORM (singleton) ------------------------------------
create table if not exists map_georeference (
  id int primary key default 1,
  a double precision not null,
  b double precision not null,
  c double precision not null,
  d double precision not null,
  e double precision not null,
  f double precision not null,
  n_points int not null,
  rms double precision not null,
  fitted_at timestamptz not null default now(),
  constraint map_georeference_singleton check (id = 1)
);

-- Read only via the service role (classify route + scripts); no public policy.
alter table map_georeference enable row level security;
```

- [ ] **Step 2: Apply the migration**

Apply it the same way prior migrations were applied to this project's Supabase (Supabase SQL editor, `supabase db push`, or the Supabase MCP `apply_migration` with name `0007_photo_gps_and_review_provenance`). Confirm no error is returned.

- [ ] **Step 3: Verify the columns and table exist**

Run this query (SQL editor or MCP `execute_sql`):

```sql
select column_name from information_schema.columns
where table_name = 'zone_photos'
  and column_name in ('gps_lat','gps_lng','gps_accuracy','reviewed_at','review_action')
order by column_name;
select to_regclass('public.map_georeference') as georef_table;
```

Expected: 5 column rows, and `georef_table` = `map_georeference` (not null).

- [ ] **Step 4: Extend the TypeScript types**

In `src/lib/types.ts`, add near the top (after the existing `PhotoSource` type):

```typescript
export type ReviewAction = "confirmed_asis" | "reassigned" | "rejected";
```

Then extend the `ZonePhoto` type — add these fields inside the type body (after `ai_meta: AiMeta;`):

```typescript
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  reviewed_at: string | null;
  review_action: ReviewAction | null;
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `types.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_photo_gps_and_review_provenance.sql src/lib/types.ts
git commit -m "feat: schema for photo GPS, review provenance, georeference transform"
```

---

### Task 2: Georeference math module (pure)

**Files:**
- Create: `src/lib/georeference.mjs`
- Test: `tests/georeference.test.ts`

**Interfaces:**
- Produces: `polygonCentroid(shape) -> {x,y}|null`; `pointInPolygon(pt, shape) -> boolean`; `fitAffine(points) -> {a,b,c,d,e,f,n,rms}|null` where `points` is `[{lat,lng,x,y,zoneId}]`; `applyAffine(t, lat, lng) -> {x,y}`; `resolveGpsHint(transform, lat, lng, zones) -> {area, shortlist}|null`; constants `MIN_POINTS=8`, `MIN_ZONES=3`.
- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing tests**

Create `tests/georeference.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  polygonCentroid, pointInPolygon, fitAffine, applyAffine, resolveGpsHint,
} from "../src/lib/georeference.mjs";

const unitSquare = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

describe("polygonCentroid", () => {
  it("returns the centre of a unit square", () => {
    const c = polygonCentroid(unitSquare);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
  });
  it("falls back to vertex mean for a degenerate 2-point shape", () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("pointInPolygon", () => {
  it("detects inside and outside", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, unitSquare)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, unitSquare)).toBe(false);
  });
});

describe("fitAffine", () => {
  // A known transform: x = 0.5*lng + 100.25, y = -0.5*lat + 16.0 (arbitrary).
  const tx = (lat: number, lng: number) => ({ x: 0.5 * lng + 100.25, y: -0.5 * lat + 16.0 });
  const pts = [
    { lat: 32.0, lng: -96.0, zoneId: "a" },
    { lat: 32.1, lng: -96.1, zoneId: "b" },
    { lat: 32.2, lng: -96.2, zoneId: "c" },
    { lat: 32.3, lng: -96.0, zoneId: "a" },
    { lat: 32.4, lng: -96.1, zoneId: "b" },
    { lat: 32.5, lng: -96.2, zoneId: "c" },
    { lat: 32.6, lng: -96.3, zoneId: "a" },
    { lat: 32.7, lng: -96.4, zoneId: "b" },
  ].map((p) => ({ ...p, ...tx(p.lat, p.lng) }));

  it("recovers the transform from clean control points", () => {
    const t = fitAffine(pts);
    expect(t).not.toBeNull();
    const q = applyAffine(t!, 32.05, -96.05);
    const expected = tx(32.05, -96.05);
    expect(q.x).toBeCloseTo(expected.x, 4);
    expect(q.y).toBeCloseTo(expected.y, 4);
    expect(t!.rms).toBeLessThan(1e-6);
    expect(t!.n).toBe(8);
  });

  it("returns null with too few points", () => {
    expect(fitAffine(pts.slice(0, 5))).toBeNull();
  });

  it("returns null when fewer than 3 distinct zones", () => {
    const twoZones = pts.map((p, i) => ({ ...p, zoneId: i % 2 ? "a" : "b" }));
    expect(fitAffine(twoZones)).toBeNull();
  });
});

describe("resolveGpsHint", () => {
  // Identity transform so lat/lng ARE map coords for the test.
  const identity = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
  const zones = [
    { slug: "front-a", area: "front", shape: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0, y: 0.2 }] },
    { slug: "front-b", area: "front", shape: [{ x: 0.3, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.2 }, { x: 0.3, y: 0.2 }] },
    { slug: "south-a", area: "south", shape: [{ x: 0, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.2, y: 1 }, { x: 0, y: 1 }] },
  ];

  it("resolves area by containment and shortlists nearest beds in that area", () => {
    // lng=0.1, lat=0.1 sits inside front-a.
    const hint = resolveGpsHint(identity, 0.1, 0.1, zones as never);
    expect(hint).not.toBeNull();
    expect(hint!.area).toBe("front");
    expect(hint!.shortlist[0]).toBe("front-a");
    expect(hint!.shortlist).not.toContain("south-a");
  });

  it("falls back to nearest zone's area when no polygon contains the point", () => {
    // lng=0.1, lat=0.9 is outside all beds but nearest to south-a.
    const hint = resolveGpsHint(identity, 0.9, 0.1, zones as never);
    expect(hint!.area).toBe("south");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/georeference.test.ts`
Expected: FAIL — cannot find module `../src/lib/georeference.mjs`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/georeference.mjs`:

```javascript
// Pure geometry + georeference math shared by the classify route and the
// fit / area-rerun scripts. No DB or IO here. Coordinates are normalized
// 0..1 map space unless noted.

export const MIN_POINTS = 8;
export const MIN_ZONES = 3;

/** Area-weighted polygon centroid; vertex mean for degenerate shapes. */
export function polygonCentroid(shape) {
  const n = shape.length;
  if (n === 0) return null;
  const mean = () => {
    const s = shape.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / n, y: s.y / n };
  };
  if (n < 3) return mean();
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = shape[i], q = shape[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) return mean();
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Ray-casting point-in-polygon. pt and shape in the same coordinate space. */
export function pointInPolygon(pt, shape) {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const xi = shape[i].x, yi = shape[i].y, xj = shape[j].x, yj = shape[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Solve 3x3 Ax=b (Gaussian elimination, partial pivot). null if singular. */
function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let k = col; k < 4; k++) m[r][k] -= factor * m[col][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Map a lat/lng to normalized 0..1 map space via a fitted transform. */
export function applyAffine(t, lat, lng) {
  return { x: t.a * lng + t.b * lat + t.c, y: t.d * lng + t.e * lat + t.f };
}

/** Least-squares affine fit lat/lng -> map x/y from control points
 *  [{lat,lng,x,y,zoneId}]. Requires >= MIN_POINTS across >= MIN_ZONES zones.
 *  Returns {a,b,c,d,e,f,n,rms} or null. */
export function fitAffine(points) {
  const zoneIds = new Set(points.map((p) => p.zoneId));
  if (points.length < MIN_POINTS || zoneIds.size < MIN_ZONES) return null;
  const ATA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const ATx = [0, 0, 0], ATy = [0, 0, 0];
  for (const p of points) {
    const row = [p.lng, p.lat, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ATA[i][j] += row[i] * row[j];
      ATx[i] += row[i] * p.x;
      ATy[i] += row[i] * p.y;
    }
  }
  const bx = solve3(ATA, ATx);
  const by = solve3(ATA, ATy);
  if (!bx || !by) return null;
  const t = { a: bx[0], b: bx[1], c: bx[2], d: by[0], e: by[1], f: by[2] };
  let se = 0;
  for (const p of points) {
    const q = applyAffine(t, p.lat, p.lng);
    se += (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  }
  return { ...t, n: points.length, rms: Math.sqrt(se / points.length) };
}

/** Resolve a GPS point to { area, shortlist } using the transform and zone
 *  polygons. area = containing zone's area, else nearest zone's area.
 *  shortlist = up to 3 nearest-centroid zone slugs within that area.
 *  Returns null when no zone has usable geometry or no area resolves. */
export function resolveGpsHint(transform, lat, lng, zones) {
  const withShape = zones.filter((z) => Array.isArray(z.shape) && z.shape.length >= 3);
  if (withShape.length === 0) return null;
  const pt = applyAffine(transform, lat, lng);
  const dist = (z) => {
    const c = polygonCentroid(z.shape);
    return (c.x - pt.x) ** 2 + (c.y - pt.y) ** 2;
  };
  const containing = withShape.find((z) => pointInPolygon(pt, z.shape));
  const nearest = withShape.reduce((best, z) => (dist(z) < dist(best) ? z : best), withShape[0]);
  const area = (containing ?? nearest).area ?? null;
  if (!area) return null;
  const shortlist = withShape
    .filter((z) => z.area === area)
    .sort((p, q) => dist(p) - dist(q))
    .slice(0, 3)
    .map((z) => z.slug);
  return { area, shortlist };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/georeference.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/georeference.mjs tests/georeference.test.ts
git commit -m "feat: pure georeference math (centroid, point-in-polygon, affine fit, GPS hint)"
```

---

### Task 3: Read camera GPS from EXIF

**Files:**
- Modify: `src/lib/exif.ts`
- Test: `tests/exif-gps.test.ts`

**Interfaces:**
- Produces: `export type Gps = { lat: number; lng: number; accuracy: number | null }`; `parseGps(gps: unknown, accuracyRaw?: unknown) -> Gps | null` (pure); `getExifGps(file: File) -> Promise<Gps | null>` (File wrapper, mirrors existing `getExifDateTaken`).

- [ ] **Step 1: Write the failing tests**

Create `tests/exif-gps.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseGps } from "../src/lib/exif";

describe("parseGps", () => {
  it("returns lat/lng with accuracy when present", () => {
    expect(parseGps({ latitude: 32.9, longitude: -96.7 }, 4.5))
      .toEqual({ lat: 32.9, lng: -96.7, accuracy: 4.5 });
  });
  it("returns accuracy null when the error field is missing/non-numeric", () => {
    expect(parseGps({ latitude: 32.9, longitude: -96.7 }))
      .toEqual({ lat: 32.9, lng: -96.7, accuracy: null });
    expect(parseGps({ latitude: 32.9, longitude: -96.7 }, "n/a"))
      .toEqual({ lat: 32.9, lng: -96.7, accuracy: null });
  });
  it("returns null when coordinates are absent or non-finite", () => {
    expect(parseGps(null)).toBeNull();
    expect(parseGps({})).toBeNull();
    expect(parseGps({ latitude: NaN, longitude: -96.7 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/exif-gps.test.ts`
Expected: FAIL — `parseGps` is not exported from `../src/lib/exif`.

- [ ] **Step 3: Add the implementation**

Append to `src/lib/exif.ts` (below the existing `getExifDateTaken`):

```typescript
export type Gps = { lat: number; lng: number; accuracy: number | null };

/** Normalize exifr GPS output + GPSHPositioningError into {lat,lng,accuracy}
 *  or null. Pure — unit-testable without a File. */
export function parseGps(gps: unknown, accuracyRaw?: unknown): Gps | null {
  if (!gps || typeof gps !== "object") return null;
  const g = gps as { latitude?: unknown; longitude?: unknown };
  if (typeof g.latitude !== "number" || typeof g.longitude !== "number") return null;
  if (!isFinite(g.latitude) || !isFinite(g.longitude)) return null;
  const accuracy = typeof accuracyRaw === "number" && isFinite(accuracyRaw) ? accuracyRaw : null;
  return { lat: g.latitude, lng: g.longitude, accuracy };
}

/** Best-effort camera GPS from EXIF. null when absent/unreadable. */
export async function getExifGps(file: File): Promise<Gps | null> {
  try {
    const exifr = await import("exifr");
    const gps = await exifr.gps(file);
    const meta = await exifr.parse(file, ["GPSHPositioningError"]).catch(() => null);
    return parseGps(gps, meta?.GPSHPositioningError);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/exif-gps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exif.ts tests/exif-gps.test.ts
git commit -m "feat: getExifGps + pure parseGps"
```

---

### Task 4: Persist GPS through the confirm insert

**Files:**
- Modify: `src/lib/zone-photos-write.ts`
- Modify: `src/app/photos/UploadTab.tsx`
- Test: `tests/zone-photos-write.test.ts` (extend if present; create if absent)

**Interfaces:**
- Consumes: `getExifGps` (Task 3), `Gps` type.
- Produces: `ConfirmBody` gains optional `gps_lat/gps_lng/gps_accuracy: number | null`; `buildConfirmRow` passes them through when supplied.

- [ ] **Step 1: Write/extend the failing test**

Create or extend `tests/zone-photos-write.test.ts`. If the file exists, add this `it` block inside the existing `describe`; otherwise create the file with this content:

```typescript
import { describe, it, expect } from "vitest";
import { buildConfirmRow } from "../src/lib/zone-photos-write";

describe("buildConfirmRow — GPS", () => {
  it("includes gps fields when supplied", () => {
    const r = buildConfirmRow({
      storage_path: "a/b.jpg", zone_id: "z1",
      gps_lat: 32.9, gps_lng: -96.7, gps_accuracy: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.gps_lat).toBe(32.9);
      expect(r.row.gps_lng).toBe(-96.7);
      expect(r.row.gps_accuracy).toBe(5);
    }
  });
  it("omits gps fields when not supplied", () => {
    const r = buildConfirmRow({ storage_path: "a/b.jpg", zone_id: "z1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("gps_lat" in r.row).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/zone-photos-write.test.ts`
Expected: FAIL — `r.row.gps_lat` is `undefined` (fields not threaded).

- [ ] **Step 3: Thread GPS through `buildConfirmRow`**

In `src/lib/zone-photos-write.ts`, add to the `ConfirmBody` type (after `ai_meta?: AiMeta;`):

```typescript
  gps_lat?: number | null;
  gps_lng?: number | null;
  gps_accuracy?: number | null;
```

And add the three keys to the `optional` array inside `buildConfirmRow`:

```typescript
  const optional: (keyof ConfirmBody)[] = [
    "area", "review_status", "source", "ai_zone_slug", "ai_area",
    "ai_confidence", "ai_model", "is_yard", "ai_meta",
    "gps_lat", "gps_lng", "gps_accuracy",
  ];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/zone-photos-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire GPS capture into UploadTab**

In `src/app/photos/UploadTab.tsx`:

Add to the import from exif:

```typescript
import { getExifDateTaken, getExifGps, type Gps } from "@/lib/exif";
```

Add a `gps` field to the `Item` type (after `takenAt: string | null;`):

```typescript
  gps: Gps | null;
```

In `onFiles`, read GPS alongside the date and store it on the item. Replace the existing `const takenAt = await getExifDateTaken(file);` line and the initial `setItems(...)` push with:

```typescript
      const takenAt = await getExifDateTaken(file);
      const gps = await getExifGps(file);
      setItems((prev) => [...prev, { uid, file, storagePath: "", takenAt, gps, status: "classifying", chosenZoneId: "", skip: false }]);
```

In `saveOne`, add the GPS fields to the confirm request body (inside the `JSON.stringify({ ... })`, after `taken_at: it.takenAt,`):

```typescript
        gps_lat: it.gps?.lat ?? null,
        gps_lng: it.gps?.lng ?? null,
        gps_accuracy: it.gps?.accuracy ?? null,
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors in `UploadTab.tsx` or `zone-photos-write.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/zone-photos-write.ts src/app/photos/UploadTab.tsx tests/zone-photos-write.test.ts
git commit -m "feat: capture + persist camera GPS on photo upload"
```

---

### Task 5: Record review provenance (review_action + reviewed_at)

**Files:**
- Modify: `src/lib/zone-photos-review.ts`
- Modify: `src/app/api/zone-photos/review/route.ts`
- Test: `tests/zone-photos-review.test.ts` (extend)

**Interfaces:**
- Consumes: `ReviewAction` stored-value type (Task 1) — note the *stored* values (`confirmed_asis|reassigned|rejected`) differ from the *request* action names (`confirm|reassign|reject`).
- Produces: `planReviewUpdate` patch now includes `review_action`. The route stamps `reviewed_at` (ISO now) onto the patch before the update.

- [ ] **Step 1: Extend the failing tests**

In `tests/zone-photos-review.test.ts`, update the three existing expectations to include `review_action`, and add a mapping test. Replace the three `expect(...).toEqual(...)` bodies so the patches read:

```typescript
  it("reject sets rejected, no zone change", () => {
    expect(planReviewUpdate({ action: "reject", zones })).toEqual({
      ok: true, patch: { review_status: "rejected", review_action: "rejected" },
    });
  });
  it("confirm with a valid zone sets confirmed + zone + derived area", () => {
    expect(planReviewUpdate({ action: "confirm", zoneId: "z-hell", zones })).toEqual({
      ok: true,
      patch: { review_status: "confirmed", zone_id: "z-hell", area: "front", review_action: "confirmed_asis" },
    });
  });
  it("reassign with a valid zone sets confirmed + zone + derived area", () => {
    expect(planReviewUpdate({ action: "reassign", zoneId: "z-pool", zones })).toEqual({
      ok: true,
      patch: { review_status: "confirmed", zone_id: "z-pool", area: "pool", review_action: "reassigned" },
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/zone-photos-review.test.ts`
Expected: FAIL — patches lack `review_action`.

- [ ] **Step 3: Emit `review_action` from `planReviewUpdate`**

In `src/lib/zone-photos-review.ts`, update the `ReviewPlan` patch type and both return paths. Change the type:

```typescript
export type ReviewPlan =
  | { ok: true; patch: { review_status: "confirmed" | "rejected"; zone_id?: string; area?: Area | null; review_action: "confirmed_asis" | "reassigned" | "rejected" } }
  | { ok: false; error: string };
```

In the reject branch:

```typescript
  if (action === "reject") {
    return { ok: true, patch: { review_status: "rejected", review_action: "rejected" } };
  }
```

In the confirm/reassign branch, set `review_action` from the request action (`confirm` accepts the AI's grouping = `confirmed_asis`; `reassign` overrides it):

```typescript
    return {
      ok: true,
      patch: {
        review_status: "confirmed",
        zone_id: zoneId,
        area: areaForZone(zoneId, zones),
        review_action: action === "confirm" ? "confirmed_asis" : "reassigned",
      },
    };
```

- [ ] **Step 4: Stamp `reviewed_at` in the route**

In `src/app/api/zone-photos/review/route.ts`, replace the update call so the patch carries `reviewed_at`:

```typescript
  const patch = { ...plan.patch, reviewed_at: new Date().toISOString() };
  const { error, count } = await supabase
    .from("zone_photos")
    .update(patch, { count: "exact" })
    .in("id", ids);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/zone-photos-review.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zone-photos-review.ts src/app/api/zone-photos/review/route.ts tests/zone-photos-review.test.ts
git commit -m "feat: record review_action + reviewed_at on every review action"
```

---

### Task 6: GPS backfill script

**Files:**
- Create: `scripts/backfill-photo-gps.mjs`

**Interfaces:**
- Consumes: `walkImages`, `sourceRefFor` (`scripts/lib/photo-file.mjs`); `exifr`; `createClient`.
- Produces: a runnable script `node scripts/backfill-photo-gps.mjs --dir <root> [--dry-run]` that reads GPS from each local original and `UPDATE`s the matching `zone_photos` row by `source_ref`.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-photo-gps.mjs`:

```javascript
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import exifr from "exifr";
import { createClient } from "@supabase/supabase-js";
import { walkImages, sourceRefFor } from "./lib/photo-file.mjs";

config({ path: ".env.local" });
config();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .env.local`); process.exit(1); }
  return v;
}

function parseFlags(argv) {
  const flags = { dir: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") flags.dir = argv[++i];
    else if (argv[i] === "--dry-run") flags.dryRun = true;
  }
  return flags;
}

async function readGps(filePath) {
  try {
    const buf = await readFile(filePath);
    const gps = await exifr.gps(buf);
    const meta = await exifr.parse(buf, ["GPSHPositioningError"]).catch(() => null);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      const acc = typeof meta?.GPSHPositioningError === "number" ? meta.GPSHPositioningError : null;
      return { lat: gps.latitude, lng: gps.longitude, accuracy: acc };
    }
  } catch { /* unreadable — treat as no-fix */ }
  return null;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.dir) { console.error("usage: --dir <root> [--dry-run]"); process.exit(1); }
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const files = await walkImages(flags.dir);
  let withGps = 0, updated = 0, noFix = 0, noRow = 0;

  for (const filePath of files) {
    const sourceRef = sourceRefFor(flags.dir, filePath);
    const gps = await readGps(filePath);
    if (!gps) { noFix++; continue; }
    withGps++;
    if (flags.dryRun) continue;

    const { data, error } = await supabase
      .from("zone_photos")
      .update({ gps_lat: gps.lat, gps_lng: gps.lng, gps_accuracy: gps.accuracy })
      .eq("source_ref", sourceRef)
      .select("id");
    if (error) { console.error(`  ! ${sourceRef}: ${error.message}`); continue; }
    if (!data || data.length === 0) { noRow++; continue; }
    updated += data.length;
  }

  console.log(`files=${files.length} with_gps=${withGps} no_fix=${noFix}` +
    (flags.dryRun ? " (dry-run, no writes)" : ` updated=${updated} no_matching_row=${noRow}`));
  console.log(`GPS coverage: ${files.length ? ((withGps / files.length) * 100).toFixed(1) : "0"}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add an npm script**

In `package.json`, add to `"scripts"` (after `"import:photos"`):

```json
    "backfill:gps": "node scripts/backfill-photo-gps.mjs"
```

- [ ] **Step 3: Verify the coverage report on the real originals (dry-run)**

Run (substitute the real local originals folder used for the batch import):

```bash
node scripts/backfill-photo-gps.mjs --dir <path-to-local-originals> --dry-run
```

Expected: a line reporting `files=…`, `with_gps=…`, `no_fix=…`, and a `GPS coverage: NN.N%`. This quantifies how many of the ~3,000 photos carry a fix **before** any writes. If coverage is near zero, stop and investigate whether the transfer path stripped EXIF (do not proceed to the write step).

- [ ] **Step 4: Run the real backfill**

```bash
node scripts/backfill-photo-gps.mjs --dir <path-to-local-originals>
```

Expected: `updated=…` roughly equal to `with_gps`, and `no_matching_row` small (a large `no_matching_row` means the `--dir` root differs from the import root that produced `source_ref` — fix the root and re-run; the operation is idempotent).

- [ ] **Step 5: Spot-check the DB**

```sql
select count(*) filter (where gps_lat is not null) as with_gps, count(*) as total from zone_photos;
```

Expected: `with_gps` matches the script's `updated` total.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-photo-gps.mjs package.json
git commit -m "feat: backfill photo GPS from local originals (--dry-run coverage report)"
```

---

### Task 7: Fit the georeference transform

**Files:**
- Create: `scripts/fit-georeference.mjs`

**Interfaces:**
- Consumes: `fitAffine`, `polygonCentroid` (Task 2); `createClient`.
- Produces: a runnable script `node scripts/fit-georeference.mjs [--dry-run]` that fits the transform from human-reviewed GPS photos and upserts the `map_georeference` singleton.

- [ ] **Step 1: Write the script**

Create `scripts/fit-georeference.mjs`:

```javascript
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fitAffine, polygonCentroid } from "../src/lib/georeference.mjs";

config({ path: ".env.local" });
config();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .env.local`); process.exit(1); }
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  // Trustworthy control points: human-reviewed, has GPS, has a bed.
  const { data: photos, error: pErr } = await supabase
    .from("zone_photos")
    .select("gps_lat, gps_lng, zone_id")
    .not("reviewed_at", "is", null)
    .not("gps_lat", "is", null)
    .not("zone_id", "is", null);
  if (pErr) throw pErr;

  const { data: zones, error: zErr } = await supabase.from("zones").select("id, shape");
  if (zErr) throw zErr;
  const centroidById = new Map(
    (zones ?? [])
      .filter((z) => Array.isArray(z.shape) && z.shape.length >= 3)
      .map((z) => [z.id, polygonCentroid(z.shape)]),
  );

  const points = [];
  for (const p of photos ?? []) {
    const c = centroidById.get(p.zone_id);
    if (!c) continue;
    points.push({ lat: p.gps_lat, lng: p.gps_lng, x: c.x, y: c.y, zoneId: p.zone_id });
  }

  const transform = fitAffine(points);
  if (!transform) {
    const zoneCount = new Set(points.map((p) => p.zoneId)).size;
    console.log(`Not enough control points to fit (points=${points.length}, distinct zones=${zoneCount}; need >=8 across >=3 zones). No write.`);
    process.exit(0);
  }

  console.log(`Fitted transform: n=${transform.n} rms=${transform.rms.toFixed(5)} (map units)`);
  if (dryRun) { console.log("(dry-run, no write)"); return; }

  const { error: upErr } = await supabase.from("map_georeference").upsert({
    id: 1, a: transform.a, b: transform.b, c: transform.c,
    d: transform.d, e: transform.e, f: transform.f,
    n_points: transform.n, rms: transform.rms, fitted_at: new Date().toISOString(),
  });
  if (upErr) throw upErr;
  console.log("map_georeference upserted.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add an npm script**

In `package.json` `"scripts"`, add:

```json
    "fit:georeference": "node scripts/fit-georeference.mjs"
```

- [ ] **Step 3: Verify (dry-run)**

Run: `node scripts/fit-georeference.mjs --dry-run`

Expected — one of two valid outcomes:
- If enough human-reviewed GPS photos exist across ≥3 zones: `Fitted transform: n=… rms=…`.
- Otherwise: the "Not enough control points" message. This is the documented bootstrap gap — the owner reviews ~10–15 spread-out photos (a few per area), then re-runs. Do **not** fabricate points to force a fit.

- [ ] **Step 4: Fit for real once the threshold is met**

Run: `node scripts/fit-georeference.mjs`
Expected: `map_georeference upserted.` Then verify: `select id, n_points, round(rms::numeric, 5) as rms from map_georeference;` returns one row.

- [ ] **Step 5: Commit**

```bash
git add scripts/fit-georeference.mjs package.json
git commit -m "feat: fit georeference transform from human-reviewed GPS photos"
```

---

### Task 8: GPS prior in the classifier + classify route

**Files:**
- Modify: `src/lib/zone-classifier.mjs`
- Modify: `src/app/api/zone-photos/classify/route.ts`
- Test: `tests/zone-classifier-gps.test.ts`

**Interfaces:**
- Consumes: `resolveGpsHint` (Task 2); `exifr`; `map_georeference` + `zones.shape` (Task 1).
- Produces: `gpsPriorText(hint) -> string` (empty string when no usable hint); the classify route appends it to the system prompt when the photo has GPS and the transform is active.

- [ ] **Step 1: Write the failing test**

Create `tests/zone-classifier-gps.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { gpsPriorText } from "../src/lib/zone-classifier.mjs";

describe("gpsPriorText", () => {
  it("names the area and shortlist", () => {
    const s = gpsPriorText({ area: "south", shortlist: ["raised-bed", "dry-mineral-bed"] });
    expect(s).toContain("SOUTH");
    expect(s).toContain("raised-bed");
    expect(s).toContain("dry-mineral-bed");
  });
  it("returns empty string for a null/empty hint", () => {
    expect(gpsPriorText(null)).toBe("");
    expect(gpsPriorText({ area: null, shortlist: [] })).toBe("");
  });
  it("handles an area with no shortlist", () => {
    const s = gpsPriorText({ area: "front", shortlist: [] });
    expect(s).toContain("FRONT");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/zone-classifier-gps.test.ts`
Expected: FAIL — `gpsPriorText` is not exported.

- [ ] **Step 3: Add `gpsPriorText` to the classifier**

Append to `src/lib/zone-classifier.mjs`:

```javascript
/** Optional GPS-derived prior appended to the system prompt. Empty string when
 *  there is no usable hint (keeps the caller branch-free). */
export function gpsPriorText(hint) {
  if (!hint || !hint.area) return "";
  const beds = hint.shortlist && hint.shortlist.length
    ? ` The nearest beds are: ${hint.shortlist.join(", ")}.`
    : "";
  const A = hint.area.toUpperCase();
  return `\n\nCAMERA GPS PRIOR: The camera's GPS location places this photo in the ${A} area.${beds} Strongly prefer a zone in the ${A} area; override this only if the image clearly and unambiguously shows a different, named area (for example, a photo taken across the yard).`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/zone-classifier-gps.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the prior into the classify route**

In `src/app/api/zone-photos/classify/route.ts`:

Add imports at the top:

```typescript
import exifr from "exifr";
import { resolveGpsHint } from "@/lib/georeference.mjs";
```

Update the classifier import to include `gpsPriorText`:

```typescript
import {
  buildSystemPrompt,
  buildClassificationSchema,
  classifyImage,
  gpsPriorText,
} from "@/lib/zone-classifier.mjs";
```

After the `input` buffer is created and before `buildSystemPrompt` is called, resolve the GPS hint from the **original** blob (batch-import display copies have no EXIF, so this is a no-op for those, and vision-only remains the fallback):

```typescript
  let gpsHint = null;
  try {
    const gps = await exifr.gps(input);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      const { data: geo } = await supabase.from("map_georeference").select("*").eq("id", 1).maybeSingle();
      if (geo) {
        const { data: zonesGeo } = await supabase
          .from("zones").select("slug, area, shape").not("area", "is", null);
        gpsHint = resolveGpsHint(geo, gps.latitude, gps.longitude, zonesGeo ?? []);
      }
    }
  } catch {
    // no GPS / no transform — fall back to vision-only
  }
```

Then change the system-prompt line to append the prior:

```typescript
  const systemPrompt = buildSystemPrompt(zones ?? []) + gpsPriorText(gpsHint);
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors in `classify/route.ts`.

- [ ] **Step 7: Verify the route end-to-end in the dev app**

Start the dev server (via the preview tooling, not a raw shell), open `/photos` in edit mode, and drag in a **geotagged** photo. Confirm via `mcp__Claude_Browser__preview_logs` / network that `/api/zone-photos/classify` returns 200 and the suggested area matches the photo's real area. (If the transform isn't fitted yet, the route silently runs vision-only — that's correct; re-check after Task 7's real fit.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/zone-classifier.mjs src/app/api/zone-photos/classify/route.ts tests/zone-classifier-gps.test.ts
git commit -m "feat: inject GPS area prior into the live classifier"
```

---

### Task 9: Re-run areas from GPS (backlog + auto-tagged)

**Files:**
- Create: `scripts/lib/area-rerun-core.mjs`
- Create: `scripts/rerun-area-from-gps.mjs`
- Test: `tests/area-rerun.test.ts`

**Interfaces:**
- Consumes: `resolveGpsHint`, `map_georeference`, `zones.shape` (Tasks 1–2).
- Produces: `planAreaRerun(row, gpsArea) -> patch | null` (pure); a runnable script `node scripts/rerun-area-from-gps.mjs [--dry-run]` that corrects `area` on non-human-reviewed rows and re-opens disagreements to `pending`.

- [ ] **Step 1: Write the failing test**

Create `tests/area-rerun.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { planAreaRerun } from "../scripts/lib/area-rerun-core.mjs";

describe("planAreaRerun", () => {
  it("returns null when GPS gives no area", () => {
    expect(planAreaRerun({ area: "front" }, null)).toBeNull();
  });
  it("returns null when the stored area already agrees", () => {
    expect(planAreaRerun({ area: "south" }, "south")).toBeNull();
  });
  it("fills a null stored area silently (no re-open)", () => {
    expect(planAreaRerun({ area: null }, "front")).toEqual({ area: "front" });
  });
  it("re-opens a disagreeing row to pending", () => {
    expect(planAreaRerun({ area: "front" }, "south")).toEqual({ area: "south", review_status: "pending" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/area-rerun.test.ts`
Expected: FAIL — cannot find module `../scripts/lib/area-rerun-core.mjs`.

- [ ] **Step 3: Write the pure core**

Create `scripts/lib/area-rerun-core.mjs`:

```javascript
/** Decide the area patch for a NON-human-reviewed photo given the GPS-derived
 *  area. null = no change. A disagreement re-opens the photo for review; a null
 *  stored area is filled silently. */
export function planAreaRerun(row, gpsArea) {
  if (!gpsArea) return null;
  if (row.area === gpsArea) return null;
  if (row.area == null) return { area: gpsArea };
  return { area: gpsArea, review_status: "pending" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/area-rerun.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the re-run script**

Create `scripts/rerun-area-from-gps.mjs`:

```javascript
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolveGpsHint } from "../src/lib/georeference.mjs";
import { planAreaRerun } from "./lib/area-rerun-core.mjs";

config({ path: ".env.local" });
config();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .env.local`); process.exit(1); }
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { data: geo } = await supabase.from("map_georeference").select("*").eq("id", 1).maybeSingle();
  if (!geo) { console.error("No georeference transform yet — run fit:georeference first."); process.exit(1); }

  const { data: zones, error: zErr } = await supabase
    .from("zones").select("slug, area, shape").not("area", "is", null);
  if (zErr) throw zErr;

  // Non-human-reviewed rows that carry a GPS fix (pending + auto-confirmed).
  const { data: rows, error: rErr } = await supabase
    .from("zone_photos")
    .select("id, area, gps_lat, gps_lng")
    .is("reviewed_at", null)
    .not("gps_lat", "is", null);
  if (rErr) throw rErr;

  let filled = 0, reopened = 0, unchanged = 0;
  for (const row of rows ?? []) {
    const hint = resolveGpsHint(geo, row.gps_lat, row.gps_lng, zones ?? []);
    const patch = planAreaRerun(row, hint?.area ?? null);
    if (!patch) { unchanged++; continue; }
    if (patch.review_status === "pending") reopened++; else filled++;
    if (dryRun) continue;
    const { error } = await supabase.from("zone_photos").update(patch).eq("id", row.id);
    if (error) console.error(`  ! ${row.id}: ${error.message}`);
  }

  console.log(`rows=${(rows ?? []).length} filled=${filled} reopened=${reopened} unchanged=${unchanged}` +
    (dryRun ? " (dry-run, no writes)" : ""));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Add an npm script**

In `package.json` `"scripts"`, add:

```json
    "rerun:area": "node scripts/rerun-area-from-gps.mjs"
```

- [ ] **Step 7: Verify (dry-run) then run**

Run: `node scripts/rerun-area-from-gps.mjs --dry-run`
Expected: a `rows=… filled=… reopened=… unchanged=…` line. Review the `reopened` count (photos whose GPS-area disagreed with the stored area — these return to the review queue). Then run for real: `node scripts/rerun-area-from-gps.mjs`.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/area-rerun-core.mjs scripts/rerun-area-from-gps.mjs tests/area-rerun.test.ts package.json
git commit -m "feat: re-derive photo area from GPS for non-human-reviewed rows"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all suites pass, including the new `georeference`, `exif-gps`, `zone-photos-write`, `zone-photos-review`, `zone-classifier-gps`, and `area-rerun` tests.

- [ ] **Typecheck**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Operational sequence (run once, in order):** `backfill:gps` (dry-run → real) → owner reviews ~10–15 spread photos → `fit:georeference` (dry-run → real) → `rerun:area` (dry-run → real). New uploads now carry GPS automatically and the classify route applies the prior live.

---

## Self-Review notes

- **Spec coverage:** migration + provenance columns (Task 1) ✓; `getExifGps` + UploadTab wiring (Tasks 3–4) ✓; `review_action`/`reviewed_at` (Task 5) ✓; backfill script + `--dry-run` (Task 6) ✓; georeference fit + threshold + storage (Tasks 2, 7) ✓; GPS prior in classify (Task 8) ✓; GPS area re-run (Task 9) ✓. Phase 2 items (text-lesson hints, `framing` flag, image exemplars) are intentionally out of scope.
- **Deferred open items** (spec's "open items"): the georeference is fitted by a manual script rather than auto-refit-on-confirmation (simplest shippable choice; auto-refit is a Phase 1.5/2 follow-up); the GPS-error radius is handled implicitly by "nearest-3 within the resolved area" rather than a metric radius; the area re-run re-opens on any area disagreement (no distance margin) — revisit if it proves too aggressive.
- **Type consistency:** stored `review_action` values (`confirmed_asis|reassigned|rejected`) are distinct from request actions (`confirm|reassign|reject`) — verified the mapping in Task 5. `resolveGpsHint` returns `{area, shortlist}`, consumed unchanged by `gpsPriorText` (Task 8) and the re-run script (Task 9).
