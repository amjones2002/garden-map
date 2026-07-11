# Photo Classification Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify ~3,038 historical yard photos into existing zones/areas with Claude Vision (Batches API) and import downscaled copies + rich enrichment into `zone_photos`, seeding a review queue.

**Architecture:** Reuse the existing `zones` + `zone_photos` tables. A migration adds an `area` layer, review-queue columns, and a flexible `ai_meta` jsonb. A shared classifier module (prompt + JSON schema + request builders) is consumed by a resumable two-step node script (`submit` → `collect`) that downscales locally, batches the vision calls, and writes rows. The same classifier module is what Phase 2's live upload path will reuse.

**Tech Stack:** Next.js 16 / TypeScript · Supabase (Postgres + Storage) · `@anthropic-ai/sdk` (Batches + Messages) · `sharp` (downscale) · `exifr` (EXIF) · `vitest` (tests) · plain ESM `.mjs` scripts run with `node`.

## Global Constraints

Every task's requirements implicitly include these, copied verbatim from the spec:

- **Model:** `claude-sonnet-4-6`, via the **Message Batches API** (50% discount) for the historical backlog; **structured outputs** on (`output_config.format`, `json_schema`).
- **Compression:** image sent to the API = **1568px long edge, JPEG q80** (transient, not stored). Image stored in Supabase = **1280px long edge, JPEG q75 (~180 KB)**, EXIF stripped. Local export folder is the archival master; Supabase holds only display copies.
- **Areas:** `front | pool | south`. Zone → area map: front = `hellstrip, foundation-bed, north-side-yard, stock-tank, front-yard`; pool = `cedar-planters, pool-spa, alley`; south = `dry-mineral-bed, front-raised-bed`.
- **Data model:** reuse `zone_photos`; `zone_id` becomes **nullable** (area-only photos); public-read RLS restricted to `review_status = 'confirmed'`; `source_ref` gives re-run idempotency.
- **Enrichment:** core queryable columns + one `ai_meta jsonb`. `plants` is its own **preserved, never-pruned** array — kept separate from `botanical`/`tags`.
- **Confidence threshold:** default **0.70** separates auto-`confirmed` (has a zone slug) from `pending`. Tunable via `--threshold`.
- **Junk gate:** photos with `is_yard = false` are **skipped** (not uploaded, not inserted); recorded in the dry-run report only.
- **Conventions:** service-role key writes (bypasses RLS) via server/script code; scripts load env from `.env.local` then `.env`; scripts live in `scripts/`, shared script helpers in `scripts/lib/`.

---

### Task 1: Dependencies, env, and the `0005` migration

**Files:**
- Modify: `package.json` (add deps + `import:photos` script)
- Modify: `.env.example` (add `ANTHROPIC_API_KEY`)
- Modify: `.gitignore` (ignore `.import-cache/`)
- Create: `supabase/migrations/0005_photo_classification.sql`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `garden_photos`-free schema all later tasks rely on — `zones.area`, and `zone_photos` columns `area`, `review_status`, `source`, `source_ref`, `ai_zone_slug`, `ai_area`, `ai_confidence`, `ai_model`, `caption`, `is_yard`, `ai_meta` (jsonb). `zone_photos.zone_id` is nullable.

- [ ] **Step 1: Add dependencies**

Run:
```bash
npm install @anthropic-ai/sdk exifr
```
Expected: `@anthropic-ai/sdk` and `exifr` added to `dependencies`. (`sharp`, `@supabase/supabase-js`, `dotenv` are already present.)

- [ ] **Step 2: Add the run script to `package.json`**

In the `"scripts"` block, add:
```json
"import:photos": "node scripts/import-photos.mjs"
```

- [ ] **Step 3: Add the API key to `.env.example`**

Append under the server-only secrets section:
```bash
# Anthropic API key (server/script-only; used by the photo classifier)
ANTHROPIC_API_KEY=your-anthropic-api-key
```

- [ ] **Step 4: Ignore the local import cache**

Append to `.gitignore`:
```
# Local downscale cache + batch manifest for the photo import script
.import-cache/
```

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0005_photo_classification.sql`:
```sql
-- Photo classification: area layer on zones, review-queue + AI enrichment on
-- zone_photos, and confirmed-only public read.

-- 1) AREA LAYER ON ZONES ----------------------------------------------------
alter table zones add column if not exists area text
  check (area is null or area in ('front','pool','south'));

-- Backfill by slug, falling back to name (robust to editor-generated slugs).
update zones set area = 'front'
  where area is null and (
    slug in ('hellstrip','foundation-bed','north-side-yard','stock-tank','front-yard')
    or lower(name) in ('hellstrip','foundation bed','north side yard','stock tank fountain','front yard')
  );
update zones set area = 'pool'
  where area is null and (
    slug in ('cedar-planters','pool-spa','alley')
    or lower(name) in ('cedar planters','pool & spa','pool','alley')
  );
update zones set area = 'south'
  where area is null and (
    slug in ('dry-mineral-bed','front-raised-bed')
    or lower(name) in ('dry mineral bed','front raised bed (8x3)','front raised bed')
  );

-- 2) REVIEW QUEUE + AI ENRICHMENT ON ZONE_PHOTOS ----------------------------
alter table zone_photos alter column zone_id drop not null;

alter table zone_photos
  add column if not exists area text
    check (area is null or area in ('front','pool','south')),
  add column if not exists review_status text not null default 'confirmed'
    check (review_status in ('pending','confirmed','rejected')),
  add column if not exists source text not null default 'manual'
    check (source in ('manual','batch_import','phone_sync')),
  add column if not exists source_ref text,
  add column if not exists ai_zone_slug text,
  add column if not exists ai_area text,
  add column if not exists ai_confidence numeric,
  add column if not exists ai_model text,
  add column if not exists caption text,
  add column if not exists is_yard boolean,
  add column if not exists ai_meta jsonb not null default '{}'::jsonb;

-- Idempotent re-runs: a given source photo imports at most once.
create unique index if not exists zone_photos_source_ref_idx
  on zone_photos (source_ref) where source_ref is not null;

-- Review-queue and enrichment query paths.
create index if not exists zone_photos_review_status_idx on zone_photos (review_status);
create index if not exists zone_photos_area_idx on zone_photos (area);
create index if not exists zone_photos_ai_meta_idx on zone_photos using gin (ai_meta);

-- 3) PUBLIC READ = CONFIRMED ONLY ------------------------------------------
drop policy if exists "public read zone_photos" on zone_photos;
create policy "public read zone_photos" on zone_photos
  for select using (review_status = 'confirmed');
```

- [ ] **Step 6: Apply and verify the migration**

Apply `supabase/migrations/0005_photo_classification.sql` via the Supabase SQL Editor (paste & run) or the Supabase MCP, then verify:
```sql
select slug, name, area from zones order by area, slug;
```
Expected: every zone has a non-null `area` (10 rows: 5 front, 3 pool, 2 south). If `Alley` or `Front Yard` show `null`, their slug/name differs from the backfill — set them manually:
```sql
update zones set area = 'pool'  where lower(name) = 'alley';
update zones set area = 'front' where lower(name) = 'front yard';
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore supabase/migrations/0005_photo_classification.sql
git commit -m "feat: migration + deps for photo classification pipeline"
```

---

### Task 2: Shared classifier module

**Files:**
- Create: `src/lib/zone-classifier.mjs`
- Test: `tests/zone-classifier.test.ts`

**Interfaces:**
- Consumes: a `zones` array of `{ slug, name, area, description }` (fetched from Supabase by the caller).
- Produces (all exported from `src/lib/zone-classifier.mjs`):
  - `MODEL` — string `'claude-sonnet-4-6'`.
  - `AREAS` — `['front','pool','south']`.
  - `buildSystemPrompt(zones)` → string.
  - `buildClassificationSchema(zoneSlugs)` → JSON-schema object.
  - `buildBatchRequest({ customId, systemPrompt, schema, base64Image, mediaType })` → `{ custom_id, params }` for `batches.create`.
  - `parseClassification(text)` → normalized object `{ is_yard, quality, area, zone_slug, confidence, reasoning, caption, tags, plants, hardscape, botanical }`.
  - `classifyImage(client, { systemPrompt, schema, base64Image, mediaType })` → `Promise<normalized>` (real-time single call; used by Phase 2).

Written as `.mjs` (not `.ts`) so the `node` import script and Next.js can both import it without a TypeScript build step.

- [ ] **Step 1: Write the failing tests**

Create `tests/zone-classifier.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildClassificationSchema,
  parseClassification,
  MODEL,
} from "../src/lib/zone-classifier.mjs";

const ZONES = [
  { slug: "stock-tank", name: "Stock Tank Fountain", area: "front", description: "Stock tank fountain." },
  { slug: "pool-spa", name: "Pool & Spa", area: "pool", description: "Pool and spa." },
  { slug: "front-raised-bed", name: "Front Raised Bed", area: "south", description: "8x3 raised bed." },
];

describe("buildSystemPrompt", () => {
  const p = buildSystemPrompt(ZONES);
  it("lists every zone slug", () => {
    for (const z of ZONES) expect(p).toContain(z.slug);
  });
  it("groups zones under their area headings", () => {
    expect(p.toLowerCase()).toContain("front");
    expect(p.toLowerCase()).toContain("pool");
    expect(p.toLowerCase()).toContain("south");
  });
  it("names the Red Oak divider and the permanent anchors", () => {
    expect(p).toContain("Red Oak");
    expect(p.toLowerCase()).toContain("fence");
    expect(p.toLowerCase()).toContain("pool");
  });
  it("tells the model to ignore transient foreground", () => {
    expect(p.toLowerCase()).toContain("ignore");
    expect(p.toLowerCase()).toContain("plant");
  });
});

describe("buildClassificationSchema", () => {
  const schema = buildClassificationSchema(ZONES.map((z) => z.slug));
  it("constrains zone_slug to the known slugs plus null", () => {
    const zs = schema.properties.zone_slug;
    const flat = JSON.stringify(zs);
    expect(flat).toContain("stock-tank");
    expect(flat).toContain("null");
  });
  it("keeps plants as its own array property", () => {
    expect(schema.properties.plants.type).toBe("array");
  });
  it("forbids extra properties", () => {
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("parseClassification", () => {
  it("parses a full valid payload", () => {
    const r = parseClassification(JSON.stringify({
      is_yard: true, quality: "good", area: "front", zone_slug: "stock-tank",
      confidence: 0.9, reasoning: "brick + oak", caption: "Stock tank in summer",
      tags: ["summer"], plants: ["milkweed", "coneflower"],
      hardscape: { stock_tank: true, raised_beds: false, vines: false, cover_crop_field: false, cedar_planters: false },
      botanical: { bloom_colors: ["orange"], notes: "monarch habitat" },
    }));
    expect(r.zone_slug).toBe("stock-tank");
    expect(r.plants).toEqual(["milkweed", "coneflower"]);
    expect(r.hardscape.stock_tank).toBe(true);
  });
  it("fills defaults for missing arrays/objects", () => {
    const r = parseClassification(JSON.stringify({
      is_yard: false, quality: "poor", area: null, zone_slug: null, confidence: 0.1,
    }));
    expect(r.plants).toEqual([]);
    expect(r.tags).toEqual([]);
    expect(r.hardscape).toEqual({});
    expect(r.botanical).toEqual({});
  });
});

describe("MODEL", () => {
  it("is Sonnet 4.6", () => expect(MODEL).toBe("claude-sonnet-4-6"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/zone-classifier.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/zone-classifier.mjs'`.

- [ ] **Step 3: Write the module**

Create `src/lib/zone-classifier.mjs`:
```js
// Shared Claude Vision classifier for garden photos. Consumed by the batch
// import script (Phase 1) and the live upload path (Phase 2).

export const MODEL = "claude-sonnet-4-6";
export const AREAS = ["front", "pool", "south"];

/** Strict system prompt anchored on permanent hardscape, grouped by area. */
export function buildSystemPrompt(zones) {
  const byArea = { front: [], pool: [], south: [] };
  for (const z of zones) {
    if (byArea[z.area]) byArea[z.area].push(z);
  }
  const zoneLines = AREAS.map((area) => {
    const items = byArea[area]
      .map((z) => `    - ${z.slug} — ${z.name}: ${z.description ?? ""}`.trimEnd())
      .join("\n");
    return `  ${area.toUpperCase()}:\n${items || "    (none)"}`;
  }).join("\n");

  return `You classify historical photographs of a single residential yard in Richardson, TX (a corner lot). Your job is to decide WHICH part of THIS yard each photo shows, using only the PERMANENT architecture — never the plants or temporary features, which change constantly across the 1.5 years of photos.

PERMANENT ANCHORS (these never move — judge location by these alone):
- A one-story BRICK house with consistent siding, windows, and a covered porch on the west side.
- An A/C pad and small shed on the NORTH side of the house.
- A concrete patio between the house and the pool.
- A kidney-shaped POOL and an octagonal SPA on the east side.
- A concrete DRIVEWAY on the southeast, leading to an alley.
- A wood FENCE (southeast) and the property boundary.
- A frontage parkway / sidewalk along the street (southwest).
- A giant RED OAK tree. The Red Oak is the firm FRONT ↔ SOUTH divider: anything past (south of) the Red Oak is the SOUTH area.

AREAS and their ZONES (return one of these zone slugs when you can identify the exact bed; otherwise return just the area):
${zoneLines}

RULES:
- IGNORE transient foreground entirely when deciding location: plants, flowers, mulch, tools, furniture, and hardscaping that was ADDED over time (the stock tank fountain, raised beds, vines, cover-crop field, cedar planters). These are the CHANGES we are dating — not anchors. A bed that does not physically exist yet in a photo cannot be the answer.
- Choose the most specific zone slug you are confident about. If you can identify the area but not the exact bed, set zone_slug to null and still return the area.
- If the photo is NOT of this yard (screenshot, receipt, indoor shot, unrelated), set is_yard=false.
- confidence is your confidence in the zone_slug (0–1). If zone_slug is null, it is your confidence in the area.

ENRICHMENT (fill even when location is uncertain):
- caption: one plain sentence describing the photo.
- tags: short freeform keywords.
- plants: EVERY plant you can identify by name. Do not limit the count; list them all.
- hardscape: which of these permanent-ish additions are visibly present.
- botanical: bloom_colors seen, plus any notes.

Respond ONLY with the required JSON object.`;
}

/** JSON schema for structured outputs. zone_slug/area constrained to known values or null. */
export function buildClassificationSchema(zoneSlugs) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      is_yard: { type: "boolean" },
      quality: { type: "string", enum: ["good", "ok", "poor"] },
      area: { anyOf: [{ type: "string", enum: AREAS }, { type: "null" }] },
      zone_slug: { anyOf: [{ type: "string", enum: zoneSlugs }, { type: "null" }] },
      confidence: { type: "number" },
      reasoning: { type: "string" },
      caption: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      plants: { type: "array", items: { type: "string" } },
      hardscape: {
        type: "object",
        additionalProperties: false,
        properties: {
          stock_tank: { type: "boolean" },
          raised_beds: { type: "boolean" },
          vines: { type: "boolean" },
          cover_crop_field: { type: "boolean" },
          cedar_planters: { type: "boolean" },
        },
        required: ["stock_tank", "raised_beds", "vines", "cover_crop_field", "cedar_planters"],
      },
      botanical: {
        type: "object",
        additionalProperties: false,
        properties: {
          bloom_colors: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
        required: ["bloom_colors", "notes"],
      },
    },
    required: [
      "is_yard", "quality", "area", "zone_slug", "confidence", "reasoning",
      "caption", "tags", "plants", "hardscape", "botanical",
    ],
  };
}

const userContent = (base64Image, mediaType) => [
  { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
  { type: "text", text: "Classify this photo of the yard." },
];

/** One entry for the Batches API `requests` array. */
export function buildBatchRequest({ customId, systemPrompt, schema, base64Image, mediaType }) {
  return {
    custom_id: customId,
    params: {
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent(base64Image, mediaType) }],
      output_config: { format: { type: "json_schema", schema } },
    },
  };
}

/** Normalize the model's JSON text into a stable shape with defaults. */
export function parseClassification(text) {
  const raw = typeof text === "string" ? JSON.parse(text) : text;
  return {
    is_yard: raw.is_yard === true,
    quality: raw.quality ?? "ok",
    area: raw.area ?? null,
    zone_slug: raw.zone_slug ?? null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    reasoning: raw.reasoning ?? "",
    caption: raw.caption ?? "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    plants: Array.isArray(raw.plants) ? raw.plants : [],
    hardscape: raw.hardscape && typeof raw.hardscape === "object" ? raw.hardscape : {},
    botanical: raw.botanical && typeof raw.botanical === "object" ? raw.botanical : {},
  };
}

/** Real-time single classification (Phase 2 live path). */
export async function classifyImage(client, { systemPrompt, schema, base64Image, mediaType }) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent(base64Image, mediaType) }],
    output_config: { format: { type: "json_schema", schema } },
  });
  const textBlock = msg.content.find((b) => b.type === "text");
  return parseClassification(textBlock ? textBlock.text : "{}");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/zone-classifier.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zone-classifier.mjs tests/zone-classifier.test.ts
git commit -m "feat: shared Claude Vision zone classifier"
```

---

### Task 3: Photo file helpers (walk, capture date, downscale)

**Files:**
- Create: `scripts/lib/photo-file.mjs`
- Test: `tests/photo-file.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (uses `sharp`, `exifr`, `fs`, `path`).
- Produces (exported from `scripts/lib/photo-file.mjs`):
  - `IMAGE_EXTS` — `Set(['.jpg','.jpeg','.png'])`.
  - `walkImages(dir)` → `Promise<string[]>` absolute image paths (recursive).
  - `parseFilenameDate(name)` → `Date | null`.
  - `extractCaptureDate(filePath, buffer)` → `Promise<{ date: Date, source: 'exif'|'filename'|'mtime' }>`.
  - `downscale(buffer, { maxEdge, quality })` → `Promise<Buffer>` (auto-oriented, EXIF stripped, JPEG).
  - `sourceRefFor(rootDir, filePath)` → string (POSIX relative path).

- [ ] **Step 1: Write the failing tests**

Create `tests/photo-file.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  parseFilenameDate,
  extractCaptureDate,
  downscale,
  sourceRefFor,
} from "../scripts/lib/photo-file.mjs";

describe("parseFilenameDate", () => {
  it("reads an 8-digit date embedded in the filename", () => {
    const d = parseFilenameDate("IMG_20240615_101500.jpg");
    expect(d?.getUTCFullYear()).toBe(2024);
    expect(d?.getUTCMonth()).toBe(5); // June (0-indexed)
    expect(d?.getUTCDate()).toBe(15);
  });
  it("returns null when there is no plausible date", () => {
    expect(parseFilenameDate("photo.jpg")).toBeNull();
    expect(parseFilenameDate("IMG_99999999.jpg")).toBeNull(); // invalid month/day
  });
});

describe("downscale", () => {
  it("caps the long edge and shrinks the byte size", async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 140, b: 70 } },
    }).jpeg().toBuffer();
    const small = await downscale(big, { maxEdge: 1280, quality: 75 });
    const meta = await sharp(small).metadata();
    expect(meta.width).toBe(1280);
    expect(small.length).toBeLessThanOrEqual(big.length);
  });
});

describe("extractCaptureDate", () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "photo-file-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("uses the filename date when EXIF is absent", async () => {
    const p = join(dir, "IMG_20230704_080000.jpg");
    const buf = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
    await writeFile(p, buf);
    const { date, source } = await extractCaptureDate(p, buf);
    expect(source).toBe("filename");
    expect(date.getUTCFullYear()).toBe(2023);
  });

  it("falls back to mtime when nothing else is available", async () => {
    const p = join(dir, "no-date.jpg");
    const buf = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).jpeg().toBuffer();
    await writeFile(p, buf);
    const when = new Date("2022-01-02T03:04:05Z");
    await utimes(p, when, when);
    const { source } = await extractCaptureDate(p, buf);
    expect(source).toBe("mtime");
  });
});

describe("sourceRefFor", () => {
  it("returns a POSIX relative path", () => {
    expect(sourceRefFor("/root/dir", "/root/dir/sub/img.jpg")).toBe("sub/img.jpg");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/photo-file.test.ts`
Expected: FAIL — `Cannot find module '../scripts/lib/photo-file.mjs'`.

- [ ] **Step 3: Write the module**

Create `scripts/lib/photo-file.mjs`:
```js
import { readdir, stat } from "node:fs/promises";
import { join, extname, relative, sep } from "node:path";
import sharp from "sharp";
import exifr from "exifr";

export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

/** Recursively collect image file paths under `dir`. */
export async function walkImages(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkImages(full)));
    } else if (IMAGE_EXTS.has(extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** Extract a YYYYMMDD date embedded in a filename, or null. */
export function parseFilenameDate(name) {
  const m = name.match(/(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = +y, month = +mo, day = +d;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Capture date: EXIF DateTimeOriginal → filename date → file mtime. */
export async function extractCaptureDate(filePath, buffer) {
  try {
    const exif = await exifr.parse(buffer, ["DateTimeOriginal", "CreateDate"]);
    const dt = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) return { date: dt, source: "exif" };
  } catch {
    // no/invalid EXIF — fall through
  }
  const fromName = parseFilenameDate(filePath.split(sep).pop() ?? "");
  if (fromName) return { date: fromName, source: "filename" };
  const st = await stat(filePath);
  return { date: st.mtime, source: "mtime" };
}

/** Resize to maxEdge (long edge), auto-orient, strip EXIF, encode JPEG. */
export async function downscale(buffer, { maxEdge, quality }) {
  return sharp(buffer)
    .rotate() // apply EXIF orientation, then metadata is dropped on output
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/** Stable per-photo identifier: POSIX relative path from the import root. */
export function sourceRefFor(rootDir, filePath) {
  return relative(rootDir, filePath).split(sep).join("/");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/photo-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/photo-file.mjs tests/photo-file.test.ts
git commit -m "feat: photo file helpers (walk, capture date, downscale)"
```

---

### Task 4: Import core (pure result → row mapping)

**Files:**
- Create: `scripts/lib/import-core.mjs`
- Test: `tests/import-core.test.ts`

**Interfaces:**
- Consumes: normalized classification objects from `parseClassification` (Task 2), and manifest entries `{ captureDate, captureSource, sourceRef }`.
- Produces (exported from `scripts/lib/import-core.mjs`):
  - `THRESHOLD_DEFAULT` — `0.7`.
  - `decideReviewStatus({ zoneSlug, confidence, threshold })` → `'confirmed' | 'pending'`.
  - `buildImportRecord({ classification, captureDate, captureSource, sourceRef, threshold })` → `{ skip, reason, row }` where `row` (present when `!skip`) has `{ area, ai_zone_slug, ai_area, ai_confidence, ai_model, caption, is_yard, taken_at, source, source_ref, review_status, ai_meta }`. `ai_meta` bundles `quality, reasoning, tags, plants, hardscape, botanical, capture_source`. `zone_id` and `storage_path` are resolved later by the orchestrator (they need the DB + storage), so they are intentionally absent here.

- [ ] **Step 1: Write the failing tests**

Create `tests/import-core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  THRESHOLD_DEFAULT,
  decideReviewStatus,
  buildImportRecord,
} from "../scripts/lib/import-core.mjs";

const base = {
  captureDate: new Date("2024-06-15T12:00:00Z"),
  captureSource: "exif" as const,
  sourceRef: "sub/img.jpg",
  threshold: THRESHOLD_DEFAULT,
};

const cls = (over: Record<string, unknown> = {}) => ({
  is_yard: true, quality: "good", area: "front", zone_slug: "stock-tank",
  confidence: 0.9, reasoning: "brick + oak", caption: "cap",
  tags: ["t"], plants: ["milkweed"],
  hardscape: { stock_tank: true }, botanical: { bloom_colors: ["orange"] },
  ...over,
});

describe("decideReviewStatus", () => {
  it("confirms a confident zone match", () => {
    expect(decideReviewStatus({ zoneSlug: "stock-tank", confidence: 0.8, threshold: 0.7 })).toBe("confirmed");
  });
  it("queues a low-confidence match", () => {
    expect(decideReviewStatus({ zoneSlug: "stock-tank", confidence: 0.5, threshold: 0.7 })).toBe("pending");
  });
  it("queues an area-only result (no zone slug)", () => {
    expect(decideReviewStatus({ zoneSlug: null, confidence: 0.99, threshold: 0.7 })).toBe("pending");
  });
});

describe("buildImportRecord", () => {
  it("skips non-yard photos", () => {
    const r = buildImportRecord({ classification: cls({ is_yard: false }), ...base });
    expect(r.skip).toBe(true);
    expect(r.reason).toBe("not_yard");
    expect(r.row).toBeUndefined();
  });

  it("builds a confirmed row for a confident zone match", () => {
    const r = buildImportRecord({ classification: cls(), ...base });
    expect(r.skip).toBe(false);
    expect(r.row.review_status).toBe("confirmed");
    expect(r.row.ai_zone_slug).toBe("stock-tank");
    expect(r.row.area).toBe("front");
    expect(r.row.source).toBe("batch_import");
    expect(r.row.source_ref).toBe("sub/img.jpg");
    expect(r.row.taken_at).toBe(base.captureDate.toISOString());
  });

  it("preserves plants and enrichment in ai_meta", () => {
    const r = buildImportRecord({ classification: cls(), ...base });
    expect(r.row.ai_meta.plants).toEqual(["milkweed"]);
    expect(r.row.ai_meta.hardscape.stock_tank).toBe(true);
    expect(r.row.ai_meta.capture_source).toBe("exif");
  });

  it("queues an area-only row with null zone slug", () => {
    const r = buildImportRecord({ classification: cls({ zone_slug: null, area: "pool" }), ...base });
    expect(r.skip).toBe(false);
    expect(r.row.review_status).toBe("pending");
    expect(r.row.ai_zone_slug).toBeNull();
    expect(r.row.area).toBe("pool");
  });
});

describe("THRESHOLD_DEFAULT", () => {
  it("is 0.7", () => expect(THRESHOLD_DEFAULT).toBe(0.7));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/import-core.test.ts`
Expected: FAIL — `Cannot find module '../scripts/lib/import-core.mjs'`.

- [ ] **Step 3: Write the module**

Create `scripts/lib/import-core.mjs`:
```js
import { MODEL } from "../../src/lib/zone-classifier.mjs";

export const THRESHOLD_DEFAULT = 0.7;

/** Confirmed only when we have a zone slug at/above the confidence threshold. */
export function decideReviewStatus({ zoneSlug, confidence, threshold }) {
  return zoneSlug && confidence >= threshold ? "confirmed" : "pending";
}

/**
 * Map one classification + manifest entry to an import decision.
 * Returns { skip, reason, row }. zone_id and storage_path are resolved by the
 * orchestrator (they require the DB and storage); everything else is here.
 */
export function buildImportRecord({ classification: c, captureDate, captureSource, sourceRef, threshold }) {
  if (!c.is_yard) return { skip: true, reason: "not_yard" };

  const review_status = decideReviewStatus({
    zoneSlug: c.zone_slug, confidence: c.confidence, threshold,
  });

  return {
    skip: false,
    reason: null,
    row: {
      area: c.area,
      ai_zone_slug: c.zone_slug,
      ai_area: c.area,
      ai_confidence: c.confidence,
      ai_model: MODEL,
      caption: c.caption || null,
      is_yard: true,
      taken_at: captureDate.toISOString(),
      source: "batch_import",
      source_ref: sourceRef,
      review_status,
      ai_meta: {
        quality: c.quality,
        reasoning: c.reasoning,
        tags: c.tags,
        plants: c.plants,
        hardscape: c.hardscape,
        botanical: c.botanical,
        capture_source: captureSource,
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/import-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/import-core.mjs tests/import-core.test.ts
git commit -m "feat: import-core result-to-row mapping"
```

---

### Task 5: Orchestrator script (`submit` / `collect`) + README

**Files:**
- Create: `scripts/import-photos.mjs`
- Modify: `README.md` (add a "Historical photo import" section)

**Interfaces:**
- Consumes: everything from Tasks 2–4 — `buildSystemPrompt`, `buildClassificationSchema`, `buildBatchRequest`, `parseClassification`, `MODEL` (Task 2); `walkImages`, `extractCaptureDate`, `downscale`, `sourceRefFor` (Task 3); `buildImportRecord` (Task 4). Reads env `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
- Produces: the CLI entry point (`npm run import:photos -- <submit|collect> [flags]`). No other task depends on it.

The orchestration is I/O-heavy (filesystem, Anthropic Batches, Supabase). Its pure pieces are already unit-tested in Tasks 2–4; this task is verified by a `--dry-run` on a small sample folder (Step 4), not by a unit test.

- [ ] **Step 1: Write the orchestrator**

Create `scripts/import-photos.mjs`:
```js
import { config } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  buildSystemPrompt, buildClassificationSchema, buildBatchRequest,
  parseClassification, MODEL,
} from "../src/lib/zone-classifier.mjs";
import {
  walkImages, extractCaptureDate, downscale, sourceRefFor,
} from "./lib/photo-file.mjs";
import { buildImportRecord, THRESHOLD_DEFAULT } from "./lib/import-core.mjs";
import { ZONE_PHOTOS_BUCKET } from "../src/lib/photos.ts"; // see Step 1a

config({ path: ".env.local" });
config();

const CACHE_DIR = ".import-cache";
const DISPLAY_DIR = join(CACHE_DIR, "display");
const MANIFEST = join(CACHE_DIR, "manifest.json");
const API_MAX_EDGE = 1568, API_QUALITY = 80;
const STORE_MAX_EDGE = 1280, STORE_QUALITY = 75;
// Batches API caps a batch at 256 MB / 100k requests. Chunk well under that.
const MAX_BATCH_BYTES = 180 * 1024 * 1024;
const MAX_BATCH_REQUESTS = 1000;

/** Greedily pack requests into batches bounded by byte size and count. */
function chunkRequests(requests) {
  const chunks = [];
  let cur = [], curBytes = 0;
  for (const req of requests) {
    const bytes = Buffer.byteLength(JSON.stringify(req));
    if (cur.length && (curBytes + bytes > MAX_BATCH_BYTES || cur.length >= MAX_BATCH_REQUESTS)) {
      chunks.push(cur); cur = []; curBytes = 0;
    }
    cur.push(req); curBytes += bytes;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function parseFlags(argv) {
  const flags = { dir: null, limit: Infinity, threshold: THRESHOLD_DEFAULT, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") flags.dir = argv[++i];
    else if (a === "--limit") flags.limit = Number(argv[++i]);
    else if (a === "--threshold") flags.threshold = Number(argv[++i]);
    else if (a === "--dry-run") flags.dryRun = true;
  }
  return flags;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .env.local`); process.exit(1); }
  return v;
}

async function fetchZones(supabase) {
  const { data, error } = await supabase
    .from("zones").select("id, slug, name, area, description")
    .not("area", "is", null);
  if (error) throw error;
  return data;
}

// ---- SUBMIT ---------------------------------------------------------------
async function submit(flags) {
  if (!flags.dir) { console.error("submit requires --dir <folder>"); process.exit(1); }
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

  const zones = await fetchZones(supabase);
  const systemPrompt = buildSystemPrompt(zones);
  const schema = buildClassificationSchema(zones.map((z) => z.slug));

  // Skip already-imported source_refs (idempotent re-runs).
  const { data: existing } = await supabase.from("zone_photos").select("source_ref").not("source_ref", "is", null);
  const done = new Set((existing ?? []).map((r) => r.source_ref));

  await mkdir(DISPLAY_DIR, { recursive: true });
  const files = (await walkImages(flags.dir)).slice(0, flags.limit);
  const requests = [];
  const manifest = {};

  for (const file of files) {
    const sourceRef = sourceRefFor(flags.dir, file);
    if (done.has(sourceRef)) { console.log(`skip (already imported): ${sourceRef}`); continue; }

    const buffer = await readFile(file);
    const { date, source } = await extractCaptureDate(file, buffer);
    const displayBuf = await downscale(buffer, { maxEdge: STORE_MAX_EDGE, quality: STORE_QUALITY });
    const apiBuf = await downscale(buffer, { maxEdge: API_MAX_EDGE, quality: API_QUALITY });

    const key = crypto.createHash("sha1").update(sourceRef).digest("hex");
    const displayPath = join(DISPLAY_DIR, `${key}.jpg`);
    await writeFile(displayPath, displayBuf);

    const customId = key.slice(0, 64);
    manifest[customId] = { sourceRef, captureDate: date.toISOString(), captureSource: source, displayPath };
    requests.push(buildBatchRequest({ customId, systemPrompt, schema, base64Image: apiBuf.toString("base64"), mediaType: "image/jpeg" }));
    console.log(`prepared: ${sourceRef} (${source} date)`);
  }

  if (requests.length === 0) { console.log("Nothing new to submit."); return; }

  const chunks = chunkRequests(requests);
  const batchIds = [];
  for (const chunk of chunks) {
    const batch = await anthropic.messages.batches.create({ requests: chunk });
    batchIds.push(batch.id);
    console.log(`Submitted batch ${batch.id} (${chunk.length} requests).`);
  }
  await writeFile(MANIFEST, JSON.stringify({ batchIds, manifest }, null, 2));
  console.log(`Submitted ${requests.length} requests across ${batchIds.length} batch(es).`);
  console.log(`Run: npm run import:photos -- collect${flags.dryRun ? " --dry-run" : ""}`);
}

// ---- COLLECT --------------------------------------------------------------
async function collect(flags) {
  if (!existsSync(MANIFEST)) { console.error(`No ${MANIFEST}; run submit first.`); process.exit(1); }
  const { batchIds, manifest } = JSON.parse(await readFile(MANIFEST, "utf8"));
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

  const zones = await fetchZones(supabase);
  const slugToId = new Map(zones.map((z) => [z.slug, z.id]));
  const csvRows = [["source_ref", "area", "zone_slug", "confidence", "review_status", "is_yard", "caption"]];
  const counts = { inserted: 0, skipped: 0, errored: 0, pending: 0 };

  for (const batchId of batchIds) {
    // Poll this batch until it ends.
    let batch = await anthropic.messages.batches.retrieve(batchId);
    while (batch.processing_status !== "ended") {
      console.log(`batch ${batchId}: ${batch.processing_status} (${batch.request_counts.processing} processing)`);
      await new Promise((r) => setTimeout(r, 30000));
      batch = await anthropic.messages.batches.retrieve(batchId);
    }

    for await (const result of await anthropic.messages.batches.results(batchId)) {
    const entry = manifest[result.custom_id];
    if (!entry) continue;
    if (result.result.type !== "succeeded") {
      console.log(`errored/expired: ${entry.sourceRef} (${result.result.type})`);
      counts.errored++; continue;
    }
    const textBlock = result.result.message.content.find((b) => b.type === "text");
    const classification = parseClassification(textBlock ? textBlock.text : "{}");
    const rec = buildImportRecord({
      classification,
      captureDate: new Date(entry.captureDate),
      captureSource: entry.captureSource,
      sourceRef: entry.sourceRef,
      threshold: flags.threshold,
    });

    if (rec.skip) { counts.skipped++; continue; }
    if (rec.row.review_status === "pending") counts.pending++;

    if (flags.dryRun) {
      csvRows.push([entry.sourceRef, rec.row.area ?? "", rec.row.ai_zone_slug ?? "", rec.row.ai_confidence, rec.row.review_status, rec.row.is_yard, JSON.stringify(rec.row.caption ?? "")]);
      continue;
    }

    // Resolve zone_id + storage path, upload the display copy, insert the row.
    const zoneId = rec.row.ai_zone_slug ? slugToId.get(rec.row.ai_zone_slug) ?? null : null;
    const folder = zoneId ?? `area-${rec.row.area ?? "unsorted"}`;
    const storagePath = `${folder}/${crypto.randomUUID()}.jpg`;
    const displayBuf = await readFile(entry.displayPath);

    const up = await supabase.storage.from(ZONE_PHOTOS_BUCKET).upload(storagePath, displayBuf, { contentType: "image/jpeg", upsert: false });
    if (up.error) { console.log(`upload failed: ${entry.sourceRef} — ${up.error.message}`); counts.errored++; continue; }

    const { error } = await supabase.from("zone_photos").insert({ ...rec.row, zone_id: zoneId, storage_path: storagePath });
    if (error) {
      await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([storagePath]); // orphan cleanup
      console.log(`insert failed: ${entry.sourceRef} — ${error.message}`);
      counts.errored++; continue;
    }
    counts.inserted++;
    }
  }

  if (flags.dryRun) {
    const csvPath = join(CACHE_DIR, "dry-run.csv");
    await writeFile(csvPath, csvRows.map((r) => r.join(",")).join("\n"));
    console.log(`Dry run written to ${csvPath} (${csvRows.length - 1} rows).`);
  }
  console.log(`Done. ${JSON.stringify(counts)}`);
}

const flags = parseFlags(process.argv.slice(3));
const cmd = process.argv[2];
if (cmd === "submit") submit(flags).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "collect") collect(flags).catch((e) => { console.error(e); process.exit(1); });
else { console.error("Usage: npm run import:photos -- <submit|collect> [--dir <folder>] [--limit N] [--threshold 0.7] [--dry-run]"); process.exit(1); }
```

- [ ] **Step 1a: Fix the `ZONE_PHOTOS_BUCKET` import (node can't import `.ts`)**

`scripts/import-photos.mjs` imports `ZONE_PHOTOS_BUCKET` from `../src/lib/photos.ts`, but `node` cannot import a `.ts` file. Define the constant inline instead — replace the `import { ZONE_PHOTOS_BUCKET } from "../src/lib/photos.ts";` line with:
```js
const ZONE_PHOTOS_BUCKET = "zone-photos"; // mirrors src/lib/photos.ts
```

- [ ] **Step 2: Add the README section**

Append to `README.md` after the "Seed data" section:
````markdown
## Historical photo import

Classify a local export folder of yard photos with Claude Vision and import
downscaled copies into `zone_photos`. Requires `ANTHROPIC_API_KEY` in `.env.local`
and migration `0005` applied.

```bash
# 1. Submit the batch (downscales locally, uploads nothing yet):
npm run import:photos -- submit --dir "/path/to/photos" --limit 5

# 2. Dry run: poll the batch, print proposed classifications to
#    .import-cache/dry-run.csv (no DB/storage writes). Tune --threshold, then:
npm run import:photos -- collect --dry-run

# 3. Real import: uploads display copies + inserts rows.
npm run import:photos -- collect
```

High-confidence zone matches import as `review_status='confirmed'`; low-confidence
or area-only results land as `pending` for later review. Re-running skips photos
already imported (by `source_ref`). Your local folder is the archival master —
Supabase stores only the ~180 KB display copies.
````

- [ ] **Step 3: Verify the module loads and prints usage**

Run: `node scripts/import-photos.mjs`
Expected: prints the `Usage: ...` line and exits — confirms all imports resolve (no `.ts`/module errors).

- [ ] **Step 4: Verify against a small sample (dry run)**

Prerequisite: `.env.local` has `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and migration `0005` is applied. Put ~5 real yard photos (plus optionally one non-yard image) in a temp folder.

Run:
```bash
npm run import:photos -- submit --dir "/path/to/sample" --limit 5
npm run import:photos -- collect --dry-run
```
Expected: `submit` prints a batch id and writes `.import-cache/manifest.json`; `collect --dry-run` polls to completion and writes `.import-cache/dry-run.csv` with one row per yard photo (non-yard photo absent), each showing a plausible area/zone/confidence. No rows are written to Supabase.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-photos.mjs README.md
git commit -m "feat: photo import orchestrator (submit/collect) + docs"
```

---

## Self-Review

**Spec coverage:**
- SQL migration (`garden_photos` rejected; reuse `zone_photos`) → Task 1. ✓
- Area layer + zone→area backfill + Red Oak (already a label) → Task 1 (backfill), Task 2 (prompt names Red Oak). ✓
- `zone_id` nullable, review-queue columns, `source_ref` idempotency, `ai_meta` jsonb, confirmed-only RLS → Task 1. ✓
- Core Vision system prompt (permanent anchors, ignore-transient, enumerated zones) → Task 2. ✓
- Structured outputs / JSON schema, Sonnet 4.6, Batches API → Tasks 2 (schema/request) + 5 (batch submit/collect). ✓
- EXIF `DateTimeOriginal` → filename → mtime fallback → Task 3. ✓
- Downscale: 1568px API / 1280px q75 store → Task 3 (`downscale`) + Task 5 (constants). ✓
- Enrichment: caption, tags, hardscape flags, botanical, junk gate, **plants preserved separate** → Task 2 (schema/prompt) + Task 4 (`ai_meta` incl. `plants`). ✓
- Partial-failure handling, missing EXIF, idempotency, dry-run CSV, storage-as-display-only → Task 5 + Task 3 + Task 4. ✓
- Confidence threshold 0.70, `is_yard=false` skip → Task 4. ✓
- Phase 2 (`classifyImage` reusable) → Task 2 exports `classifyImage`. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code and test step has literal content. Step 1a explicitly corrects the one cross-language import hazard rather than leaving it implicit.

**Type consistency:** `buildImportRecord` returns `{ skip, reason, row }`; Task 5 consumes exactly those. `row` fields match the `zone_photos` columns added in Task 1 (`ai_zone_slug`, `ai_area`, `ai_confidence`, `ai_model`, `caption`, `is_yard`, `taken_at`, `source`, `source_ref`, `review_status`, `ai_meta`), with `zone_id`/`storage_path` added by the orchestrator. `parseClassification`'s output shape matches `buildImportRecord`'s `classification` reads (`is_yard`, `zone_slug`, `confidence`, `plants`, `hardscape`, etc.). `MODEL` is imported, never re-literaled. `ZONE_PHOTOS_BUCKET` mirrors `src/lib/photos.ts`.

**Storage math:** 3,038 × ~180 KB ≈ 550 MB < 1 GB tier. ✓
