# Photo Timeline Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a human the tools to clear the AI-classified photo backlog (a `/photos` review queue) and to add new photos that Claude classifies live and suggests a zone for (suggest-and-confirm).

**Architecture:** Reuse Phase 1's shared classifier (`src/lib/zone-classifier.mjs`) and the `zone_photos` / `review_status` model unchanged. Business logic lives in pure, unit-tested lib modules (mirroring `scripts/lib/import-core.mjs`); route handlers stay thin (edit-gated, wire Supabase/Anthropic) and are verified manually via the dev server, matching the existing codebase convention (no API-route unit tests exist today). A new `/photos` App-Router page hosts two tabs: *Add new photos* (live classify uploader) and *To review* (the backlog queue + an auditable auto-tag log).

**Tech Stack:** Next.js 16.2.9 (App Router), TypeScript, React, Supabase (Postgres + storage, service-role server client), `@anthropic-ai/sdk` ^0.111.0, `sharp` ^0.35.2, `exifr` ^7.1.3, Vitest 4 (jsdom, globals, `@testing-library/react`).

## Global Constraints

- **Next.js 16.2.9 breaking changes — read the bundled docs before writing any page/route code:** `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`. Specifically: **`params` and `searchParams` are `Promise`s** — `await` them in a server component, or read with React `use()` in a client component. Route handlers: `export async function GET|POST|PATCH(request: Request)`; not cached by default.
- **Reuse the shared classifier** — import `buildSystemPrompt`, `buildClassificationSchema`, `classifyImage`, `MODEL`, `AREAS` from `src/lib/zone-classifier.mjs`. Never duplicate the prompt or schema.
- **No database migration.** The schema (`0005`/`0006`) is already applied. Phase 2 is read/update + one new classify route.
- **Edit-gate everything.** Every new route calls `requireEdit()` and returns `401 { error: "locked" }` when false. The `/photos` page and the map button gate on edit mode.
- **Model** is `claude-sonnet-4-6`, referenced only via `MODEL` from the shared lib.
- **Server secret** `ANTHROPIC_API_KEY` is read only inside server route handlers via `process.env` — never `NEXT_PUBLIC_`, never sent to the browser.
- **Anthropic SDK direct** — do not use Vercel AI Gateway / the `ai` package.
- **Palette** (match existing components): page bg `#f5efe0`/`#efe7d3`, headings `#3f4a2e`, sub `#7a6a44`/`#8a8268`, borders `#cbb994`, chips `#e3dac3`, magenta accent `#8e3b5e`, confirm-green `#3f4a2e`.
- **Tests** run with `npm test` (`vitest run`); files live in `tests/**/*.test.{ts,tsx}`.
- **Commit** after every task with a `feat:`/`refactor:`/`test:` message, ending with the Co-Authored-By trailer used in this repo.

---

## File Structure

**New files**
- `src/lib/zones.ts` — area ordering/labels + pure grouping helpers (`AREA_ORDER`, `AREA_LABELS`, `areaForZone`, `groupPendingByAreaZone`).
- `src/lib/zone-photos-review.ts` — pure `planReviewUpdate` (validates action → DB patch).
- `src/lib/zone-photos-write.ts` — pure `buildConfirmRow` (maps a confirm-request body → insert row, legacy + Phase 2).
- `src/app/api/zone-photos/review/route.ts` — `PATCH` bulk status/zone update (thin).
- `src/app/api/zone-photos/classify/route.ts` — `POST` real-time classify (thin; sharp + Anthropic).
- `src/app/photos/page.tsx` — edit-gated server component; loads pending + zones + first log page.
- `src/app/photos/PhotosTabs.tsx` — client tab shell (`"use client"`).
- `src/app/photos/ReviewTab.tsx` — grouped grid, bulk confirm, reassign, reject.
- `src/app/photos/AutoTagLog.tsx` — paginated/filterable confirmed-AI log with re-open.
- `src/app/photos/UploadTab.tsx` — live classify uploader.
- Tests: `tests/zones.test.ts`, `tests/zone-photos-review.test.ts`, `tests/zone-photos-write.test.ts`, `tests/photos-tabs.test.tsx`.

**Modified files**
- `src/lib/types.ts` — add `Area`, `ReviewStatus`, `PhotoSource`, `AiMeta`; extend `Zone` and `ZonePhoto`.
- `src/app/api/zone-photos/confirm/route.ts` — persist Phase 2 fields via `buildConfirmRow`.
- `src/app/api/zone-photos/upload-url/route.ts` — allow zone-agnostic uploads (`_inbox/` prefix).
- `src/components/Nav.tsx` — edit-mode "Photos" link.

---

## Task 1: Types + zones lib (tested core)

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/zones.ts`
- Test: `tests/zones.test.ts`

**Interfaces:**
- Produces:
  - `type Area = "front" | "pool" | "south"`
  - `type ReviewStatus = "pending" | "confirmed" | "rejected"`
  - `type PhotoSource = "manual" | "batch_import" | "phone_sync"`
  - `type AiMeta = { quality?: "good"|"ok"|"poor"; reasoning?: string; tags?: string[]; plants?: string[]; hardscape?: Record<string, boolean>; botanical?: { bloom_colors?: string[]; notes?: string }; capture_source?: string; [k: string]: unknown }`
  - `Zone` gains `area: Area | null`
  - `ZonePhoto` becomes `{ id: string; zone_id: string | null; storage_path: string; caption: string | null; taken_at: string | null; uploaded_at: string; sort_order: number; area: Area | null; review_status: ReviewStatus; source: PhotoSource; source_ref: string | null; ai_zone_slug: string | null; ai_area: Area | null; ai_confidence: number | null; ai_model: string | null; is_yard: boolean | null; ai_meta: AiMeta }`
  - `AREA_ORDER: Area[]`, `AREA_LABELS: Record<Area, string>`
  - `areaForZone(zoneId: string | null, zones: Zone[]): Area | null`
  - `type ZoneGroup = { zoneSlug: string | null; zoneName: string; zoneId: string | null; photos: ZonePhoto[] }`
  - `type AreaSection = { area: Area | null; label: string; groups: ZoneGroup[]; areaOnly: ZonePhoto[] }`
  - `groupPendingByAreaZone(photos: ZonePhoto[], zones: Zone[]): AreaSection[]`

- [ ] **Step 1: Write the failing test**

Create `tests/zones.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AREA_ORDER, AREA_LABELS, areaForZone, groupPendingByAreaZone } from "../src/lib/zones";
import type { Zone, ZonePhoto } from "../src/lib/types";

const zones = [
  { id: "z-hell", slug: "hellstrip", name: "Hellstrip", area: "front" },
  { id: "z-field", slug: "the-field", name: "The Field", area: "south" },
  { id: "z-pool", slug: "pool-spa", name: "Pool & Spa", area: "pool" },
] as unknown as Zone[];

const photo = (over: Partial<ZonePhoto>): ZonePhoto =>
  ({
    id: "p", zone_id: null, storage_path: "s", caption: null, taken_at: null,
    uploaded_at: "2024-01-01T00:00:00Z", sort_order: 0, area: null,
    review_status: "pending", source: "batch_import", source_ref: null,
    ai_zone_slug: null, ai_area: null, ai_confidence: null, ai_model: null,
    is_yard: true, ai_meta: {}, ...over,
  });

describe("AREA_ORDER / AREA_LABELS", () => {
  it("orders front, pool, south", () => expect(AREA_ORDER).toEqual(["front", "pool", "south"]));
  it("labels each area", () => expect(AREA_LABELS.front).toBe("Front"));
});

describe("areaForZone", () => {
  it("returns the zone's area", () => expect(areaForZone("z-pool", zones)).toBe("pool"));
  it("returns null for null id", () => expect(areaForZone(null, zones)).toBeNull());
  it("returns null for unknown id", () => expect(areaForZone("nope", zones)).toBeNull());
});

describe("groupPendingByAreaZone", () => {
  const photos = [
    photo({ id: "a", ai_area: "front", ai_zone_slug: "hellstrip" }),
    photo({ id: "b", ai_area: "front", ai_zone_slug: "hellstrip" }),
    photo({ id: "c", ai_area: "front", ai_zone_slug: null }),
    photo({ id: "d", ai_area: "south", ai_zone_slug: "the-field" }),
    photo({ id: "e", ai_area: null, ai_zone_slug: null }),
  ];
  const sections = groupPendingByAreaZone(photos, zones);

  it("produces a section per non-empty area in order, then a null section", () => {
    expect(sections.map((s) => s.area)).toEqual(["front", "south", null]);
  });
  it("groups zoned photos by slug with the zone name", () => {
    const front = sections.find((s) => s.area === "front")!;
    expect(front.groups[0].zoneSlug).toBe("hellstrip");
    expect(front.groups[0].zoneName).toBe("Hellstrip");
    expect(front.groups[0].zoneId).toBe("z-hell");
    expect(front.groups[0].photos.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("puts zone_slug-null photos in the area's areaOnly bucket", () => {
    const front = sections.find((s) => s.area === "front")!;
    expect(front.areaOnly.map((p) => p.id)).toEqual(["c"]);
  });
  it("labels the null-area section", () => {
    const none = sections.find((s) => s.area === null)!;
    expect(none.label).toBe("Area unknown");
    expect(none.areaOnly.map((p) => p.id)).toEqual(["e"]);
  });
  it("omits areas with no pending photos", () => {
    expect(sections.find((s) => s.area === "pool")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zones`
Expected: FAIL — `src/lib/zones.ts` does not exist / exports undefined.

- [ ] **Step 3: Extend the types**

In `src/lib/types.ts`, add near the top (after the first import/line):

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
  capture_source?: string;
  [key: string]: unknown;
};
```

In the `Zone` type, add:

```ts
  area: Area | null;
```

Replace the `ZonePhoto` type body with:

```ts
export type ZonePhoto = {
  id: string;
  zone_id: string | null;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  uploaded_at: string;
  sort_order: number;
  area: Area | null;
  review_status: ReviewStatus;
  source: PhotoSource;
  source_ref: string | null;
  ai_zone_slug: string | null;
  ai_area: Area | null;
  ai_confidence: number | null;
  ai_model: string | null;
  is_yard: boolean | null;
  ai_meta: AiMeta;
};
```

- [ ] **Step 4: Implement `src/lib/zones.ts`**

```ts
import type { Area, Zone, ZonePhoto } from "./types";

export const AREA_ORDER: Area[] = ["front", "pool", "south"];
export const AREA_LABELS: Record<Area, string> = { front: "Front", pool: "Pool", south: "South" };

/** The area a zone belongs to (null when the zone/id is unknown). */
export function areaForZone(zoneId: string | null, zones: Zone[]): Area | null {
  if (!zoneId) return null;
  return zones.find((z) => z.id === zoneId)?.area ?? null;
}

export type ZoneGroup = {
  zoneSlug: string | null;
  zoneName: string;
  zoneId: string | null;
  photos: ZonePhoto[];
};

export type AreaSection = {
  area: Area | null;
  label: string;
  groups: ZoneGroup[];
  areaOnly: ZonePhoto[];
};

/**
 * Two-level grouping for the review queue: Area -> Zone groups (by ai_zone_slug,
 * largest first) plus an areaOnly bucket (ai_zone_slug === null). Areas appear in
 * AREA_ORDER, then a final null-area section for photos with no ai_area. Empty
 * areas are omitted.
 */
export function groupPendingByAreaZone(photos: ZonePhoto[], zones: Zone[]): AreaSection[] {
  const zoneBySlug = new Map(zones.map((z) => [z.slug, z]));
  const sections: AreaSection[] = [];

  for (const area of [...AREA_ORDER, null] as (Area | null)[]) {
    const inArea = photos.filter((p) => p.ai_area === area);
    if (inArea.length === 0) continue;

    const bySlug = new Map<string, ZonePhoto[]>();
    const areaOnly: ZonePhoto[] = [];
    for (const p of inArea) {
      if (p.ai_zone_slug) {
        const list = bySlug.get(p.ai_zone_slug) ?? [];
        list.push(p);
        bySlug.set(p.ai_zone_slug, list);
      } else {
        areaOnly.push(p);
      }
    }

    const groups: ZoneGroup[] = [...bySlug.entries()]
      .map(([slug, groupPhotos]) => {
        const zone = zoneBySlug.get(slug);
        return {
          zoneSlug: slug,
          zoneName: zone?.name ?? slug,
          zoneId: zone?.id ?? null,
          photos: groupPhotos,
        };
      })
      .sort((a, b) => b.photos.length - a.photos.length);

    sections.push({
      area,
      label: area ? AREA_LABELS[area] : "Area unknown",
      groups,
      areaOnly,
    });
  }

  return sections;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- zones`
Expected: PASS (all cases). Also run `npx tsc --noEmit` — expect no type errors from `types.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/zones.ts tests/zones.test.ts
git commit -m "$(printf 'feat: zone/area types + review grouping helpers\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Review-update core (tested core)

**Files:**
- Create: `src/lib/zone-photos-review.ts`
- Test: `tests/zone-photos-review.test.ts`

**Interfaces:**
- Consumes: `Zone`, `Area` from `./types`; `areaForZone` from `./zones`.
- Produces:
  - `type ReviewAction = "confirm" | "reassign" | "reject"`
  - `type ReviewPlan = { ok: true; patch: { review_status: "confirmed" | "rejected"; zone_id?: string; area?: Area | null } } | { ok: false; error: string }`
  - `planReviewUpdate(input: { action: ReviewAction; zoneId?: string | null; zones: Zone[] }): ReviewPlan`

- [ ] **Step 1: Write the failing test**

Create `tests/zone-photos-review.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planReviewUpdate } from "../src/lib/zone-photos-review";
import type { Zone } from "../src/lib/types";

const zones = [
  { id: "z-hell", slug: "hellstrip", name: "Hellstrip", area: "front" },
  { id: "z-pool", slug: "pool-spa", name: "Pool & Spa", area: "pool" },
] as unknown as Zone[];

describe("planReviewUpdate", () => {
  it("reject sets rejected, no zone change", () => {
    expect(planReviewUpdate({ action: "reject", zones })).toEqual({
      ok: true, patch: { review_status: "rejected" },
    });
  });
  it("confirm with a valid zone sets confirmed + zone + derived area", () => {
    expect(planReviewUpdate({ action: "confirm", zoneId: "z-hell", zones })).toEqual({
      ok: true, patch: { review_status: "confirmed", zone_id: "z-hell", area: "front" },
    });
  });
  it("reassign with a valid zone sets confirmed + zone + derived area", () => {
    expect(planReviewUpdate({ action: "reassign", zoneId: "z-pool", zones })).toEqual({
      ok: true, patch: { review_status: "confirmed", zone_id: "z-pool", area: "pool" },
    });
  });
  it("confirm without a zone is an error (guards area-only)", () => {
    const r = planReviewUpdate({ action: "confirm", zoneId: null, zones });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zone/i);
  });
  it("reassign to an unknown zone is an error", () => {
    const r = planReviewUpdate({ action: "reassign", zoneId: "nope", zones });
    expect(r.ok).toBe(false);
  });
  it("unknown action is an error", () => {
    const r = planReviewUpdate({ action: "bogus" as never, zones });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zone-photos-review`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/zone-photos-review.ts`**

```ts
import type { Area, Zone } from "./types";
import { areaForZone } from "./zones";

export type ReviewAction = "confirm" | "reassign" | "reject";

export type ReviewPlan =
  | { ok: true; patch: { review_status: "confirmed" | "rejected"; zone_id?: string; area?: Area | null } }
  | { ok: false; error: string };

/**
 * Validate a review action and produce the DB patch. Confirm and reassign both
 * require a zone that exists (a confirmed photo must have a bed — this guards the
 * area-only case); reject needs nothing. Pure — the route applies the patch.
 */
export function planReviewUpdate(input: {
  action: ReviewAction;
  zoneId?: string | null;
  zones: Zone[];
}): ReviewPlan {
  const { action, zoneId, zones } = input;

  if (action === "reject") {
    return { ok: true, patch: { review_status: "rejected" } };
  }

  if (action === "confirm" || action === "reassign") {
    if (!zoneId) return { ok: false, error: "a zone_id is required to confirm a photo" };
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return { ok: false, error: `unknown zone_id: ${zoneId}` };
    return {
      ok: true,
      patch: { review_status: "confirmed", zone_id: zoneId, area: areaForZone(zoneId, zones) },
    };
  }

  return { ok: false, error: `unknown action: ${String(action)}` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- zone-photos-review`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zone-photos-review.ts tests/zone-photos-review.test.ts
git commit -m "$(printf 'feat: review-update planner core\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Confirm-row mapper (tested core)

**Files:**
- Create: `src/lib/zone-photos-write.ts`
- Test: `tests/zone-photos-write.test.ts`

**Interfaces:**
- Consumes: `Area`, `ReviewStatus`, `PhotoSource`, `AiMeta` from `./types`.
- Produces:
  - `type ConfirmBody = { zone_id?: string | null; storage_path?: string; caption?: string | null; taken_at?: string | null; area?: Area | null; review_status?: ReviewStatus; source?: PhotoSource; ai_zone_slug?: string | null; ai_area?: Area | null; ai_confidence?: number | null; ai_model?: string | null; is_yard?: boolean | null; ai_meta?: AiMeta }`
  - `type ConfirmResult = { ok: true; row: Record<string, unknown> } | { ok: false; error: string }`
  - `buildConfirmRow(body: ConfirmBody): ConfirmResult`

- [ ] **Step 1: Write the failing test**

Create `tests/zone-photos-write.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildConfirmRow } from "../src/lib/zone-photos-write";

describe("buildConfirmRow", () => {
  it("errors without a storage_path", () => {
    const r = buildConfirmRow({ zone_id: "z1" });
    expect(r.ok).toBe(false);
  });

  it("maps a legacy manual body (no AI fields) and omits AI keys", () => {
    const r = buildConfirmRow({ zone_id: "z1", storage_path: "z1/a.jpg", caption: "  hi  ", taken_at: "2024-06-01T00:00:00Z" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.zone_id).toBe("z1");
      expect(r.row.storage_path).toBe("z1/a.jpg");
      expect(r.row.caption).toBe("hi");
      expect(r.row.taken_at).toBe("2024-06-01T00:00:00Z");
      expect("ai_zone_slug" in r.row).toBe(false);
      expect("review_status" in r.row).toBe(false);
    }
  });

  it("trims an empty caption to null", () => {
    const r = buildConfirmRow({ zone_id: "z1", storage_path: "s", caption: "   " });
    if (r.ok) expect(r.row.caption).toBeNull();
  });

  it("persists Phase 2 fields when present", () => {
    const r = buildConfirmRow({
      zone_id: "z1", storage_path: "_inbox/x.jpg", area: "pool",
      review_status: "confirmed", source: "manual",
      ai_zone_slug: "pool-spa", ai_area: "pool", ai_confidence: 0.84, ai_model: "claude-sonnet-4-6",
      is_yard: true, ai_meta: { reasoning: "brick", plants: ["salvia"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.area).toBe("pool");
      expect(r.row.review_status).toBe("confirmed");
      expect(r.row.source).toBe("manual");
      expect(r.row.ai_zone_slug).toBe("pool-spa");
      expect(r.row.ai_confidence).toBe(0.84);
      expect((r.row.ai_meta as { plants: string[] }).plants).toEqual(["salvia"]);
    }
  });

  it("allows a null zone_id (area-only)", () => {
    const r = buildConfirmRow({ zone_id: null, storage_path: "s", area: "front", review_status: "pending" });
    if (r.ok) expect(r.row.zone_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- zone-photos-write`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/zone-photos-write.ts`**

```ts
import type { Area, AiMeta, PhotoSource, ReviewStatus } from "./types";

export type ConfirmBody = {
  zone_id?: string | null;
  storage_path?: string;
  caption?: string | null;
  taken_at?: string | null;
  area?: Area | null;
  review_status?: ReviewStatus;
  source?: PhotoSource;
  ai_zone_slug?: string | null;
  ai_area?: Area | null;
  ai_confidence?: number | null;
  ai_model?: string | null;
  is_yard?: boolean | null;
  ai_meta?: AiMeta;
};

export type ConfirmResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Map a confirm-request body to a zone_photos insert row. Always writes the base
 * columns; adds Phase 2 columns only when the caller supplies them (so the legacy
 * per-zone uploader keeps DB defaults source='manual'/review_status='confirmed').
 */
export function buildConfirmRow(body: ConfirmBody): ConfirmResult {
  if (!body.storage_path) return { ok: false, error: "storage_path required" };

  const row: Record<string, unknown> = {
    zone_id: body.zone_id ?? null,
    storage_path: body.storage_path,
    caption: body.caption?.trim() || null,
    taken_at: body.taken_at ?? null,
  };

  const optional: (keyof ConfirmBody)[] = [
    "area", "review_status", "source", "ai_zone_slug", "ai_area",
    "ai_confidence", "ai_model", "is_yard", "ai_meta",
  ];
  for (const key of optional) {
    if (body[key] !== undefined) row[key] = body[key];
  }

  return { ok: true, row };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- zone-photos-write`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zone-photos-write.ts tests/zone-photos-write.test.ts
git commit -m "$(printf 'feat: confirm-row mapper (legacy + Phase 2 fields)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Wire confirm + upload-url routes

**Files:**
- Modify: `src/app/api/zone-photos/confirm/route.ts`
- Modify: `src/app/api/zone-photos/upload-url/route.ts`

**Interfaces:**
- Consumes: `buildConfirmRow`, `ConfirmBody` from `@/lib/zone-photos-write`.
- Produces: `POST /api/zone-photos/confirm` accepts Phase 2 fields; `GET /api/zone-photos/upload-url` accepts a call with no `zone_id` (writes under `_inbox/`).

No unit test (route handlers import `server-only` transitively; the repo has no route tests — verify via dev server below). Logic is covered by Task 3's tests.

- [ ] **Step 1: Rewrite the confirm route**

Replace `src/app/api/zone-photos/confirm/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";
import { buildConfirmRow, type ConfirmBody } from "@/lib/zone-photos-write";

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const built = buildConfirmRow(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("zone_photos").insert(built.row).select().single();

  if (error) {
    if (typeof built.row.storage_path === "string") {
      await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([built.row.storage_path]);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 2: Allow zone-agnostic upload URLs**

In `src/app/api/zone-photos/upload-url/route.ts`, replace the `zone_id`/`filename` validation and path build with:

```ts
  const zone_id = searchParams.get("zone_id");
  const filename = searchParams.get("filename");
  const type = searchParams.get("type") ?? "image/jpeg";

  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  const ext = (filename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const prefix = zone_id ?? "_inbox";
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
```

(Everything below — `createSignedUploadUrl(path)` and the response — stays unchanged.)

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (dev server)**

Run `npm run dev`. Unlock edit mode in the UI (so the edit cookie is set), then in the browser devtools console:

```js
// zone-agnostic signed URL (no zone_id) should succeed and return a _inbox path
await fetch("/api/zone-photos/upload-url?filename=test.jpg&type=image/jpeg").then(r => r.json());
```

Expected: `{ signedUrl, path }` where `path` starts with `_inbox/`. Confirm no 400.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/zone-photos/confirm/route.ts src/app/api/zone-photos/upload-url/route.ts
git commit -m "$(printf 'feat: confirm route persists Phase 2 fields; zone-agnostic upload URLs\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Review PATCH route

**Files:**
- Create: `src/app/api/zone-photos/review/route.ts`

**Interfaces:**
- Consumes: `planReviewUpdate`, `ReviewAction` from `@/lib/zone-photos-review`; `Zone` from `@/lib/types`.
- Produces: `PATCH /api/zone-photos/review` — body `{ ids: string[]; action: "confirm"|"reassign"|"reject"; zone_id?: string }`; returns `{ updated: number }` or `{ error }`.

Logic covered by Task 2's tests; verify wiring via dev server.

- [ ] **Step 1: Implement the route**

Create `src/app/api/zone-photos/review/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { planReviewUpdate, type ReviewAction } from "@/lib/zone-photos-review";
import type { Zone } from "@/lib/types";

type Body = { ids?: string[]; action?: ReviewAction; zone_id?: string };

export async function PATCH(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const { ids, action, zone_id } = body;
  if (!Array.isArray(ids) || ids.length === 0 || !action) {
    return NextResponse.json({ error: "ids[] and action required" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data: zones, error: zErr } = await supabase.from("zones").select("id, slug, name, area");
  if (zErr) return NextResponse.json({ error: zErr.message }, { status: 400 });

  const plan = planReviewUpdate({ action, zoneId: zone_id ?? null, zones: (zones ?? []) as Zone[] });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  const { error, count } = await supabase
    .from("zone_photos")
    .update(plan.patch, { count: "exact" })
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ updated: count ?? ids.length });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification (dev server)**

With `npm run dev` running and edit mode unlocked, in devtools console pick one pending photo id from the DB (or the review UI later). Test the reject path is reversible:

```js
// replace ID with a real pending zone_photos id
await fetch("/api/zone-photos/review", { method: "PATCH", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids: ["ID"], action: "reject" }) }).then(r => r.json());
```

Expected: `{ updated: 1 }`. Confirm a `confirm` with no `zone_id` returns 400 `{ error: /zone/ }`. (Reset the row's `review_status` back to `pending` afterward if you rejected a real one.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zone-photos/review/route.ts
git commit -m "$(printf 'feat: bulk review PATCH route (confirm/reassign/reject)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Classify route (live vision call)

**Files:**
- Create: `src/app/api/zone-photos/classify/route.ts`

**Interfaces:**
- Consumes: `buildSystemPrompt`, `buildClassificationSchema`, `classifyImage` from `@/lib/zone-classifier.mjs`; `getServerSupabase`, `requireEdit`, `ZONE_PHOTOS_BUCKET`.
- Produces: `POST /api/zone-photos/classify` — body `{ storage_path: string }`; returns the parsed classification object `{ is_yard, quality, area, zone_slug, confidence, reasoning, caption, tags, plants, hardscape, botanical }`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/zone-photos/classify/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";
import {
  buildSystemPrompt,
  buildClassificationSchema,
  classifyImage,
} from "@/lib/zone-classifier.mjs";

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: { storage_path?: string };
  try {
    body = (await req.json()) as { storage_path?: string };
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  const storage_path = body.storage_path;
  if (!storage_path) return NextResponse.json({ error: "storage_path required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "classifier not configured" }, { status: 500 });

  const supabase = getServerSupabase();

  const { data: blob, error: dlErr } = await supabase.storage.from(ZONE_PHOTOS_BUCKET).download(storage_path);
  if (dlErr || !blob) return NextResponse.json({ error: "could not read image" }, { status: 404 });

  const input = Buffer.from(await blob.arrayBuffer());
  const downscaled = await sharp(input).rotate().resize(1568, 1568, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const base64Image = downscaled.toString("base64");

  const { data: zones, error: zErr } = await supabase.from("zones").select("slug, name, area, description");
  if (zErr) return NextResponse.json({ error: zErr.message }, { status: 400 });

  const systemPrompt = buildSystemPrompt(zones ?? []);
  const schema = buildClassificationSchema((zones ?? []).map((z: { slug: string }) => z.slug));

  try {
    const client = new Anthropic({ apiKey });
    const result = await classifyImage(client, { systemPrompt, schema, base64Image, mediaType: "image/jpeg" });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "classify failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. (`zone-classifier.mjs` is untyped JS — imports resolve as `any`, which is expected.)

- [ ] **Step 3: Manual verification (dev server)**

Ensure `ANTHROPIC_API_KEY` is in your local `.env`. With `npm run dev` + edit mode unlocked, pick a real `storage_path` of an existing yard photo (from the DB), then:

```js
await fetch("/api/zone-photos/classify", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ storage_path: "PATH/FROM/DB.jpg" }) }).then(r => r.json());
```

Expected: a JSON object with `zone_slug`, `area`, `confidence`, `caption`, `plants`, etc. Confirm a bogus path returns 404.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zone-photos/classify/route.ts
git commit -m "$(printf 'feat: live classify route (sharp downscale + shared classifier)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: `/photos` page shell + tabs

**Files:**
- Create: `src/app/photos/page.tsx`
- Create: `src/app/photos/PhotosTabs.tsx`
- Test: `tests/photos-tabs.test.tsx`

**Interfaces:**
- Consumes: `getServerSupabase`, `requireEdit`; `groupPendingByAreaZone`, `AreaSection` from `@/lib/zones`; `Zone`, `ZonePhoto` from `@/lib/types`.
- Produces: `PhotosTabs` (client) props `{ sections: AreaSection[]; zones: Zone[]; pendingCount: number; initialTab: "upload" | "review" }`. Renders a two-tab shell; `ReviewTab`/`UploadTab` are added in later tasks — for now render placeholders (`<div data-testid="tab-upload">` / `<div data-testid="tab-review">`).

- [ ] **Step 1: Write the failing test**

Create `tests/photos-tabs.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhotosTabs from "../src/app/photos/PhotosTabs";

const props = { sections: [], zones: [], pendingCount: 7, initialTab: "upload" as const };

describe("PhotosTabs", () => {
  it("defaults to the upload tab and shows the pending count on the review tab", () => {
    render(<PhotosTabs {...props} />);
    expect(screen.getByTestId("tab-upload")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-review")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /to review/i })).toHaveTextContent("7");
  });

  it("switches to the review tab on click", () => {
    render(<PhotosTabs {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /to review/i }));
    expect(screen.getByTestId("tab-review")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-upload")).not.toBeInTheDocument();
  });

  it("honors initialTab=review", () => {
    render(<PhotosTabs {...props} initialTab="review" />);
    expect(screen.getByTestId("tab-review")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- photos-tabs`
Expected: FAIL — `PhotosTabs` not found.

- [ ] **Step 3: Implement `PhotosTabs.tsx` (placeholder tab bodies)**

```tsx
"use client";
import { useState } from "react";
import type { AreaSection } from "@/lib/zones";
import type { Zone } from "@/lib/types";

type Tab = "upload" | "review";

export default function PhotosTabs({
  sections,
  zones,
  pendingCount,
  initialTab,
}: {
  sections: AreaSection[];
  zones: Zone[];
  pendingCount: number;
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  void sections;
  void zones;

  const tabBtn = (active: boolean): React.CSSProperties => ({
    background: "transparent",
    border: "none",
    borderBottom: `2px solid ${active ? "#8e3b5e" : "transparent"}`,
    color: active ? "#3f4a2e" : "#8a8268",
    fontSize: 15,
    fontWeight: active ? 500 : 400,
    padding: "8px 12px",
    cursor: "pointer",
  });

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ color: "#3f4a2e", marginTop: 0 }}>Photos</h1>
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #cbb994", marginBottom: 14 }}>
        <button style={tabBtn(tab === "upload")} onClick={() => setTab("upload")}>
          Add new photos
        </button>
        <button style={tabBtn(tab === "review")} onClick={() => setTab("review")}>
          To review <span style={{ color: "#8e3b5e" }}>{pendingCount.toLocaleString()}</span>
        </button>
      </div>
      {tab === "upload" ? <div data-testid="tab-upload" /> : <div data-testid="tab-review" />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- photos-tabs`
Expected: PASS.

- [ ] **Step 5: Implement the server page**

Create `src/app/photos/page.tsx` (note: `searchParams` is a Promise in Next 16 — `await` it):

```tsx
import { redirect } from "next/navigation";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { groupPendingByAreaZone } from "@/lib/zones";
import type { Zone, ZonePhoto } from "@/lib/types";
import PhotosTabs from "./PhotosTabs";

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await requireEdit())) redirect("/");

  const { tab } = await searchParams;
  const initialTab = tab === "review" ? "review" : "upload";

  const supabase = getServerSupabase();
  const [{ data: zones }, { data: pending }] = await Promise.all([
    supabase.from("zones").select("*").is("archived_at", null).order("sort_order"),
    supabase.from("zone_photos").select("*").eq("review_status", "pending"),
  ]);

  const zoneList = (zones ?? []) as Zone[];
  const pendingList = (pending ?? []) as ZonePhoto[];
  const sections = groupPendingByAreaZone(pendingList, zoneList);

  return (
    <PhotosTabs
      sections={sections}
      zones={zoneList}
      pendingCount={pendingList.length}
      initialTab={initialTab}
    />
  );
}
```

- [ ] **Step 6: Manual verification (dev server)**

Run `npm run dev`. Visit `/photos` while **locked** → expect redirect to `/`. Unlock edit mode, revisit `/photos` → expect the "Photos" heading, two tabs, and the review tab showing the live pending count. Visit `/photos?tab=review` → review tab active.

- [ ] **Step 7: Commit**

```bash
git add src/app/photos/page.tsx src/app/photos/PhotosTabs.tsx tests/photos-tabs.test.tsx
git commit -m "$(printf 'feat: /photos page shell with upload/review tabs\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Review tab (grouped grid, bulk confirm, reassign, reject)

**Files:**
- Create: `src/app/photos/ReviewTab.tsx`
- Modify: `src/app/photos/PhotosTabs.tsx` (render `ReviewTab` instead of the review placeholder)

**Interfaces:**
- Consumes: `AreaSection`, `ZoneGroup` from `@/lib/zones`; `Zone`, `ZonePhoto` from `@/lib/types`; `publicPhotoUrl` from `@/lib/photos`; `PATCH /api/zone-photos/review`.
- Produces: `ReviewTab` props `{ sections: AreaSection[]; zones: Zone[] }`.

- [ ] **Step 1: Implement `ReviewTab.tsx`**

```tsx
"use client";
import { useState } from "react";
import Image from "next/image";
import type { AreaSection, ZoneGroup } from "@/lib/zones";
import type { Zone, ZonePhoto } from "@/lib/types";
import { publicPhotoUrl } from "@/lib/photos";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

async function patchReview(ids: string[], action: "confirm" | "reassign" | "reject", zone_id?: string) {
  const res = await fetch("/api/zone-photos/review", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, action, zone_id }),
  });
  if (!res.ok) throw new Error(await res.text());
}

function Thumb({
  photo,
  zones,
  onDone,
}: {
  photo: ZonePhoto;
  zones: Zone[];
  onDone: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const run = async (action: "reassign" | "reject", zone_id?: string) => {
    setBusy(true);
    setErr(false);
    try {
      await patchReview([photo.id], action, zone_id);
      onDone(photo.id);
    } catch {
      setErr(true);
      setBusy(false);
    }
  };
  return (
    <figure style={{ margin: 0, position: "relative", opacity: busy ? 0.5 : 1 }}>
      <Image
        src={publicPhotoUrl(SUPABASE_URL, photo.storage_path)}
        alt={photo.caption ?? "pending photo"}
        width={110}
        height={83}
        style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #cbb994", display: "block" }}
      />
      {photo.ai_confidence != null && (
        <span style={{ position: "absolute", top: 3, left: 3, background: "rgba(63,74,46,0.85)", color: "#fff", fontSize: 9, padding: "1px 4px", borderRadius: 4 }}>
          {photo.ai_confidence.toFixed(2)}
        </span>
      )}
      <figcaption style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <select
          aria-label="Reassign zone"
          defaultValue=""
          disabled={busy}
          onChange={(e) => e.target.value && run("reassign", e.target.value)}
          style={{ fontSize: 10, flex: 1, minWidth: 0, border: "1px solid #cbb994", borderRadius: 3, background: "#f5efe0" }}
        >
          <option value="">move…</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </select>
        <button onClick={() => run("reject")} disabled={busy} aria-label="Reject" style={{ border: "none", background: "transparent", color: "#8e3b5e", cursor: "pointer", fontSize: 11 }}>
          ✕
        </button>
      </figcaption>
      {err && <span style={{ color: "#8e3b5e", fontSize: 9 }}>failed</span>}
    </figure>
  );
}

function Group({ group, zones }: { group: ZoneGroup; zones: Zone[] }) {
  const [remaining, setRemaining] = useState<ZonePhoto[]>(group.photos);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remove = (id: string) => setRemaining((r) => r.filter((p) => p.id !== id));

  const confirmAll = async () => {
    if (!group.zoneId) return;
    setBusy(true);
    setErr(null);
    try {
      await patchReview(remaining.map((p) => p.id), "confirm", group.zoneId);
      setRemaining([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (remaining.length === 0) return null;
  return (
    <div style={{ background: "#f5efe0", border: "1px solid #cbb994", borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: "#3f4a2e" }}>
          <b>{group.zoneName}</b> <span style={{ color: "#8a8268", fontSize: 12 }}>· {remaining.length}</span>
        </div>
        <button onClick={confirmAll} disabled={busy} style={{ background: "#3f4a2e", border: "none", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
          Confirm all correct
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
        {remaining.map((p) => (
          <Thumb key={p.id} photo={p} zones={zones} onDone={remove} />
        ))}
      </div>
      {err && <p style={{ color: "#8e3b5e", fontSize: 12 }}>{err}</p>}
    </div>
  );
}

function AreaOnlyBucket({ photos, label, zones }: { photos: ZonePhoto[]; label: string; zones: Zone[] }) {
  const [remaining, setRemaining] = useState<ZonePhoto[]>(photos);
  const remove = (id: string) => setRemaining((r) => r.filter((p) => p.id !== id));
  if (remaining.length === 0) return null;
  return (
    <div style={{ background: "#f5efe0", border: "1px solid #d8b58c", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 14, color: "#8a5a2e", marginBottom: 8 }}>
        <b>{label} — needs a bed</b>{" "}
        <span style={{ color: "#8a8268", fontSize: 12 }}>· {remaining.length} · pick a zone to confirm</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
        {remaining.map((p) => (
          <Thumb key={p.id} photo={p} zones={zones} onDone={remove} />
        ))}
      </div>
    </div>
  );
}

export default function ReviewTab({ sections, zones }: { sections: AreaSection[]; zones: Zone[] }) {
  if (sections.length === 0)
    return (
      <div data-testid="tab-review">
        <p style={{ color: "#8a8268" }}>Nothing pending — the queue is clear.</p>
      </div>
    );
  return (
    <div data-testid="tab-review">
      {sections.map((section) => (
        <section key={section.label} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: "#3f4a2e", borderBottom: "1px solid #cbb994", paddingBottom: 4, marginBottom: 10 }}>
            {section.label}
          </div>
          {section.groups.map((g) => (
            <Group key={g.zoneSlug ?? "none"} group={g} zones={zones} />
          ))}
          <AreaOnlyBucket photos={section.areaOnly} label={section.label} zones={zones} />
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `PhotosTabs.tsx`**

At the top of `src/app/photos/PhotosTabs.tsx` add:

```tsx
import ReviewTab from "./ReviewTab";
```

Remove the `void sections; void zones;` lines, and replace the render line:

```tsx
      {tab === "upload" ? <div data-testid="tab-upload" /> : <div data-testid="tab-review" />}
```

with:

```tsx
      {tab === "upload" ? <div data-testid="tab-upload" /> : <ReviewTab sections={sections} zones={zones} />}
```

- [ ] **Step 3: Run the tab test to verify it still passes**

Run: `npm test -- photos-tabs`
Expected: PASS — the empty-`sections` case renders `ReviewTab`'s "queue is clear" message inside the `data-testid="tab-review"` wrapper (both the empty and non-empty returns carry that testid), which is all the test asserts.

- [ ] **Step 4: Manual verification (dev server)**

Unlock edit mode, open `/photos?tab=review`. Expect Area → Zone groups with thumbnails and confidence badges. Test: reject one photo (✕) → it disappears; reassign one via the dropdown → it disappears from the group. Click "Confirm all correct" on a small group → the group empties. Reload the public map and open that zone → the confirmed photos now appear (RLS). Re-open `/photos?tab=review` → confirmed/rejected photos are gone from pending.

- [ ] **Step 5: Commit**

```bash
git add src/app/photos/ReviewTab.tsx src/app/photos/PhotosTabs.tsx
git commit -m "$(printf 'feat: review tab — grouped grid, bulk confirm, reassign, reject\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Auto-tag log (paginated, filterable, re-openable)

**Files:**
- Create: `src/app/photos/AutoTagLog.tsx`
- Modify: `src/app/photos/ReviewTab.tsx` (render `<AutoTagLog zones={zones} />` at the bottom)

**Interfaces:**
- Consumes: `getBrowserSupabase` from `@/lib/supabase/client`; `Zone`, `ZonePhoto` from `@/lib/types`; `publicPhotoUrl`; `PATCH /api/zone-photos/review`.
- Produces: `AutoTagLog` props `{ zones: Zone[] }`. Reads confirmed AI-tagged photos itself (client-side, paginated) — note the browser/anon client can read `confirmed` rows under RLS.

- [ ] **Step 1: Implement `AutoTagLog.tsx`**

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { publicPhotoUrl } from "@/lib/photos";
import type { Zone, ZonePhoto } from "@/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PAGE = 25;

export default function AutoTagLog({ zones }: { zones: Zone[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ZonePhoto[]>([]);
  const [page, setPage] = useState(0);
  const [zoneFilter, setZoneFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const nameById = new Map(zones.map((z) => [z.id, z.name]));

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    let q = sb
      .from("zone_photos")
      .select("*")
      .eq("review_status", "confirmed")
      .not("ai_zone_slug", "is", null)
      .order("taken_at", { ascending: false, nullsFirst: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (zoneFilter) q = q.eq("zone_id", zoneFilter);
    const { data } = await q;
    setRows((data ?? []) as ZonePhoto[]);
    setLoading(false);
  }, [page, zoneFilter]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const reopen = async (id: string, action: "reject" | "reassign", zone_id?: string) => {
    await fetch("/api/zone-photos/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], action, zone_id }),
    });
    setRows((r) => r.filter((p) => p.id !== id));
  };

  return (
    <div style={{ borderTop: "1px solid #cbb994", paddingTop: 8, marginTop: 8 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "transparent", border: "none", color: "#7a6a44", fontSize: 13, cursor: "pointer" }}>
        Auto-tagged log {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <select value={zoneFilter} onChange={(e) => { setPage(0); setZoneFilter(e.target.value); }} style={{ fontSize: 12, marginBottom: 8, border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0", padding: "4px 8px" }}>
            <option value="">All zones</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          {loading && <p style={{ fontSize: 12, color: "#8a8268" }}>Loading…</p>}
          {rows.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: 6, background: "#f5efe0", border: "1px solid #cbb994", borderRadius: 8, marginBottom: 5 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicPhotoUrl(SUPABASE_URL, p.storage_path)} alt="" style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 4, flex: "0 0 auto" }} />
              <div style={{ flex: 1 }}>
                <b>{p.ai_zone_slug}</b> · {p.ai_area ?? "—"} · conf {p.ai_confidence?.toFixed(2) ?? "—"} · {(p.taken_at ?? p.uploaded_at).slice(0, 10)}
                <span style={{ color: "#8a8268" }}> · now: {p.zone_id ? nameById.get(p.zone_id) ?? "—" : "—"}</span>
              </div>
              <select defaultValue="" onChange={(e) => e.target.value && reopen(p.id, "reassign", e.target.value)} aria-label="Reassign" style={{ fontSize: 11, border: "1px solid #cbb994", borderRadius: 6, background: "#fff" }}>
                <option value="">reassign…</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <button onClick={() => reopen(p.id, "reject")} style={{ fontSize: 11, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 6, padding: "3px 7px", cursor: "pointer" }}>Reject</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 6 }}>
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={{ fontSize: 12, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>← Prev</button>
            <span style={{ fontSize: 12, color: "#8a8268", alignSelf: "center" }}>page {page + 1}</span>
            <button disabled={rows.length < PAGE} onClick={() => setPage((p) => p + 1)} style={{ fontSize: 12, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it in `ReviewTab.tsx`**

Add the import at the top of `src/app/photos/ReviewTab.tsx`:

```tsx
import AutoTagLog from "./AutoTagLog";
```

At the end of the `ReviewTab` return (after the `sections.map(...)` block, still inside the `data-testid="tab-review"` wrapper), add:

```tsx
      <AutoTagLog zones={zones} />
```

Ensure the empty-state early return still renders the log:

```tsx
  if (sections.length === 0)
    return (
      <div data-testid="tab-review">
        <p style={{ color: "#8a8268" }}>Nothing pending — the queue is clear.</p>
        <AutoTagLog zones={zones} />
      </div>
    );
```

- [ ] **Step 3: Run the tab test to verify it still passes**

Run: `npm test -- photos-tabs`
Expected: PASS (the log is collapsed by default and does not query until opened, so the empty-`sections` render is unaffected).

- [ ] **Step 4: Manual verification (dev server)**

Open `/photos?tab=review`, expand "Auto-tagged log". Expect a paginated list of confirmed AI-tagged photos, newest first. Filter by a zone. Reject one → it disappears; reload the map's zone and confirm it's gone. Reassign one → it moves. Page Next/Prev works.

- [ ] **Step 5: Commit**

```bash
git add src/app/photos/AutoTagLog.tsx src/app/photos/ReviewTab.tsx
git commit -m "$(printf 'feat: auto-tagged log — paginated, filterable, re-openable\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Upload tab (live classify + suggest-and-confirm)

**Files:**
- Create: `src/app/photos/UploadTab.tsx`
- Modify: `src/app/photos/PhotosTabs.tsx` (render `UploadTab` instead of the upload placeholder)

**Interfaces:**
- Consumes: `Zone` from `@/lib/types`; `MODEL` from `@/lib/zone-classifier.mjs`; `GET /api/zone-photos/upload-url`, `POST /api/zone-photos/classify`, `POST /api/zone-photos/confirm`.
- Produces: `UploadTab` props `{ zones: Zone[] }`.

The per-file EXIF helper is copied from `ZonePanel.tsx` (`getExifDateTaken`) — extract it to reuse. To avoid duplication, first move `getExifDateTaken` into `src/lib/photos.ts` is undesirable (it imports `exifr`, a client-only concern) — instead create a tiny client module.

- [ ] **Step 1: Extract the EXIF helper to a shared client module**

Create `src/lib/exif.ts`:

```ts
/** Best-effort capture date: EXIF DateTimeOriginal/CreateDate, else file mtime. */
export async function getExifDateTaken(file: File): Promise<string | null> {
  try {
    const exifr = await import("exifr");
    const result = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const d: unknown = result?.DateTimeOriginal ?? result?.CreateDate;
    if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  } catch {
    // EXIF not available — fall through
  }
  return file.lastModified ? new Date(file.lastModified).toISOString() : null;
}
```

Update `src/components/ZonePanel.tsx`: delete its local `getExifDateTaken` (lines 10–20) and import it instead:

```tsx
import { getExifDateTaken } from "@/lib/exif";
```

- [ ] **Step 2: Implement `UploadTab.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { Zone } from "@/lib/types";
import { getExifDateTaken } from "@/lib/exif";
import { MODEL } from "@/lib/zone-classifier.mjs";

type Classification = {
  is_yard: boolean;
  zone_slug: string | null;
  area: string | null;
  confidence: number;
  caption: string;
  reasoning: string;
  tags: string[];
  plants: string[];
  hardscape: Record<string, boolean>;
  botanical: { bloom_colors?: string[]; notes?: string };
  quality?: string;
};

type Item = {
  uid: string;
  file: File;
  storagePath: string;
  takenAt: string | null;
  status: "classifying" | "ready" | "error" | "saved";
  ai?: Classification;
  chosenZoneId: string;
  skip: boolean;
};

async function uploadAndClassify(file: File): Promise<{ storagePath: string; ai: Classification }> {
  const urlRes = await fetch(`/api/zone-photos/upload-url?filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "image/jpeg")}`);
  if (!urlRes.ok) throw new Error(await urlRes.text());
  const { signedUrl, path } = (await urlRes.json()) as { signedUrl: string; path: string };

  const put = await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
  if (!put.ok) throw new Error(`storage upload failed: ${put.status}`);

  const clsRes = await fetch("/api/zone-photos/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storage_path: path }),
  });
  if (!clsRes.ok) throw new Error(await clsRes.text());
  return { storagePath: path, ai: (await clsRes.json()) as Classification };
}

export default function UploadTab({ zones }: { zones: Zone[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const zoneIdBySlug = new Map(zones.map((z) => [z.slug, z.id]));

  async function onFiles(files: File[]) {
    for (const file of files) {
      const uid = crypto.randomUUID();
      const takenAt = await getExifDateTaken(file);
      setItems((prev) => [...prev, { uid, file, storagePath: "", takenAt, status: "classifying", chosenZoneId: "", skip: false }]);
      try {
        const { storagePath, ai } = await uploadAndClassify(file);
        setItems((prev) => prev.map((it) => it.uid === uid ? {
          ...it, storagePath, ai, status: "ready" as const,
          chosenZoneId: (ai.zone_slug && zoneIdBySlug.get(ai.zone_slug)) || "",
          skip: ai.is_yard === false,
        } : it));
      } catch {
        setItems((prev) => prev.map((it) => it.uid === uid ? { ...it, status: "error" as const } : it));
      }
    }
  }

  async function saveOne(idx: number) {
    const it = items[idx];
    if (!it.ai || !it.chosenZoneId) return;
    const zone = zones.find((z) => z.id === it.chosenZoneId);
    const res = await fetch("/api/zone-photos/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zone_id: it.chosenZoneId,
        storage_path: it.storagePath,
        caption: it.ai.caption || null,
        taken_at: it.takenAt,
        area: zone?.area ?? it.ai.area ?? null,
        review_status: "confirmed",
        source: "manual",
        ai_zone_slug: it.ai.zone_slug,
        ai_area: it.ai.area,
        ai_confidence: it.ai.confidence,
        ai_model: MODEL,
        is_yard: it.ai.is_yard,
        ai_meta: {
          quality: it.ai.quality,
          reasoning: it.ai.reasoning,
          tags: it.ai.tags,
          plants: it.ai.plants,
          hardscape: it.ai.hardscape,
          botanical: it.ai.botanical,
          capture_source: "upload",
        },
      }),
    });
    if (res.ok) setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, status: "saved" } : x)));
  }

  const saveAll = () => items.forEach((it, i) => it.status === "ready" && !it.skip && it.chosenZoneId && saveOne(i));
  const savable = items.filter((it) => it.status === "ready" && !it.skip && it.chosenZoneId).length;

  return (
    <div data-testid="tab-upload">
      <label style={{ display: "block", border: "2px dashed #cbb994", borderRadius: 12, padding: 22, textAlign: "center", background: "#f5efe0", cursor: "pointer", marginBottom: 12 }}>
        <div style={{ fontSize: 14, color: "#3f4a2e" }}>Drop new photos here — Claude sorts them into zones</div>
        <div style={{ fontSize: 11, color: "#8a8268" }}>classified server-side · you confirm each suggestion</div>
        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ""; }} />
      </label>

      {items.map((it, idx) => (
        <div key={it.uid} style={{ display: "flex", gap: 10, alignItems: "center", background: "#f5efe0", border: `1px solid ${it.skip ? "#d8b58c" : "#cbb994"}`, borderRadius: 10, padding: 8, marginBottom: 6, opacity: it.status === "saved" ? 0.5 : 1 }}>
          <div style={{ flex: 1, fontSize: 12 }}>
            <div style={{ color: "#8a8268" }}>{it.file.name}{it.takenAt ? ` · ${it.takenAt.slice(0, 10)}` : ""}</div>
            {it.status === "classifying" && <div style={{ color: "#7a6a44" }}>Classifying…</div>}
            {it.status === "error" && <div style={{ color: "#8e3b5e" }}>Classify failed — pick a zone manually</div>}
            {it.ai && it.skip && <div style={{ color: "#8a5a2e" }}>doesn’t look like the yard — skip?</div>}
            {it.ai && !it.skip && <div style={{ color: "#3f4a2e" }}>AI: <b>{it.ai.zone_slug ?? "—"}</b> ({it.ai.area ?? "—"}) · conf {it.ai.confidence.toFixed(2)}</div>}
          </div>
          {it.status !== "saved" && (
            <>
              <select value={it.chosenZoneId} onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, chosenZoneId: e.target.value } : x)))} style={{ fontSize: 12, border: "1px solid #cbb994", borderRadius: 8, background: "#fff", padding: "4px 6px" }}>
                <option value="">choose zone…</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              {it.skip
                ? <button onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} style={{ fontSize: 12, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 8, padding: "5px 9px", cursor: "pointer" }}>Skip</button>
                : <button onClick={() => saveOne(idx)} disabled={!it.chosenZoneId} style={{ fontSize: 12, border: "none", background: "#8e3b5e", color: "#fff", borderRadius: 8, padding: "5px 9px", cursor: "pointer" }}>Save</button>}
            </>
          )}
          {it.status === "saved" && <span style={{ fontSize: 12, color: "#3f4a2e" }}>saved ✓</span>}
        </div>
      ))}

      {savable > 1 && (
        <button onClick={saveAll} style={{ background: "#8e3b5e", border: "none", color: "#fff", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", marginTop: 6 }}>
          Save {savable} photos to their zones
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `PhotosTabs.tsx`**

Add the import:

```tsx
import UploadTab from "./UploadTab";
```

Replace the upload placeholder in the render:

```tsx
      {tab === "upload" ? <div data-testid="tab-upload" /> : <ReviewTab sections={sections} zones={zones} />}
```

with:

```tsx
      {tab === "upload" ? <UploadTab zones={zones} /> : <ReviewTab sections={sections} zones={zones} />}
```

- [ ] **Step 4: Run tests to verify they still pass**

Run: `npm test -- photos-tabs`
Expected: PASS (`UploadTab` renders `data-testid="tab-upload"`; no files loaded so no fetches fire).

- [ ] **Step 5: Manual verification (dev server)**

Unlock edit mode, open `/photos` (Add new photos tab). Drop a real yard photo → expect "Classifying…", then an AI suggestion with the zone dropdown pre-selected. Adjust if needed, click Save → "saved ✓". Open the public map's target zone → the photo appears. Drop a non-yard image (screenshot) → expect the "doesn't look like the yard — skip?" state.

- [ ] **Step 6: Commit**

```bash
git add src/app/photos/UploadTab.tsx src/app/photos/PhotosTabs.tsx src/lib/exif.ts src/components/ZonePanel.tsx
git commit -m "$(printf 'feat: upload tab — live classify + suggest-and-confirm\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 11: Map-page entry point

**Files:**
- Modify: `src/components/Nav.tsx`

**Interfaces:**
- Consumes: `useEditMode` from `@/lib/edit-mode`.
- Produces: a "Photos" nav link visible only in edit mode, routing to `/photos`.

- [ ] **Step 1: Add an edit-mode "Photos" link to the nav**

Rewrite `src/components/Nav.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useEditMode } from "@/lib/edit-mode";

export default function Nav() {
  const { unlocked } = useEditMode();
  const item: React.CSSProperties = { flex: 1, textAlign: "center", padding: "14px 0", minHeight: 44 };
  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        display: "flex",
        borderTop: "1px solid #cbb994",
        background: "#f5efe0",
        zIndex: 50,
      }}
    >
      <Link href="/" style={item}>Map</Link>
      <Link href="/tracker" style={item}>Tracker</Link>
      {unlocked && (
        <Link href="/photos" style={{ ...item, color: "#8e3b5e" }}>Photos</Link>
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Run the existing nav test**

Run: `npm test -- nav`
Expected: PASS. If `tests/nav.test.tsx` renders `Nav` without an `EditModeProvider`, `useEditMode` may throw (it reads a context). If so, the test must wrap `Nav` in `EditModeProvider` (from `@/lib/edit-mode`), or `useEditMode` must tolerate a null context by returning `{ unlocked: false, loading: true, ... }`. Prefer wrapping in the test:

```tsx
import { EditModeProvider } from "../src/lib/edit-mode";
// render(<EditModeProvider><Nav /></EditModeProvider>)
```

Read `tests/nav.test.tsx` and `src/lib/edit-mode.tsx` first; apply whichever fix matches the existing `useEditMode` contract (if it already returns defaults for a null context, no change is needed).

- [ ] **Step 3: Manual verification (dev server)**

While locked: the nav shows Map / Tracker only. Unlock edit mode: a magenta "Photos" link appears and routes to `/photos`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Nav.tsx tests/nav.test.tsx
git commit -m "$(printf 'feat: edit-mode Photos nav link\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 12: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass (existing + `zones`, `zone-photos-review`, `zone-photos-write`, `photos-tabs`).

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no type errors; lint clean (fix any `no-img-element`/unused-var warnings introduced).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (this compiles the App Router pages/routes and would catch async `params`/`searchParams` misuse).

- [ ] **Step 4: End-to-end manual smoke (dev server)**

With `npm run dev` + edit mode unlocked:
1. `/photos` locked → redirects to `/`. Unlocked → loads.
2. Upload tab: classify + save a real photo → appears on the map's zone.
3. Review tab: confirm a small group, reassign one, reject one → all leave pending; confirmed ones show on the map.
4. Auto-tag log: filter, page, re-open (reject/reassign) one.
5. Public (locked/anon) map still shows only confirmed photos; no pending leakage.

- [ ] **Step 5: Commit (if any lint/type fixes were needed)**

```bash
git add -A
git commit -m "$(printf 'chore: Phase 2 verification fixes\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Notes for the implementer

- **Deploy:** `ANTHROPIC_API_KEY` must be a server-side env var in Vercel (already added) and in your local `.env` for dev. Do **not** enable Anthropic Zero Data Retention (incompatible with the Phase 1 Batches pipeline and unnecessary here).
- **Why routes aren't unit-tested:** route handlers import `@/lib/supabase/server` / `@/lib/require-edit`, which pull in `server-only` and `next/headers`; the existing suite tests pure lib cores instead and verifies routes via the dev server. Follow that convention — do not add brittle route unit tests.
- **`ZonePhoto.zone_id` is now nullable** — anywhere the old non-null type was assumed (e.g. `ZonePanel` reads by `zone_id`) still works because those queries filter by a concrete zone; no changes needed beyond the type.
