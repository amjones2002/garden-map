# Photo Enrichment & "Through the Eras" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the trustworthy `ai_meta` enrichment in the photo UI (shared meta panel + a filterable public gallery) and build the deferred "through the eras" narrative timeline (deterministic milestone eras + one-time AI headlines).

**Architecture:** Pure read + render over existing `zone_photos.ai_meta`. Three shared pure/`.mjs` libs (`photo-facets.ts`, `eras.mjs`, `eras.data.ts`) feed two presentational React components (`PhotoMeta`, `PhotoLightbox`) reused across the map panel, a new `/gallery` (client-side faceting over a compact server projection), and a new `/timeline` (chapters from a committed narrative file). A standalone `scripts/generate-eras.mjs` computes era boundaries and calls Claude once per era to write `eras.data.ts`.

**Tech Stack:** Next.js 16.2.9 (App Router, breaking changes — see Global Constraints), React 19, TypeScript, Supabase JS, `@anthropic-ai/sdk` (structured outputs via `output_config`), sharp, vitest + @testing-library/react.

## Global Constraints

- **Read AGENTS.md's Next.js note before any page/route/server-component code:** this repo's Next.js (16.2.9) has breaking changes vs. training data — read `node_modules/next/dist/docs/` first (server-component data loading, route handlers, `requireEdit()` in server components).
- **No schema migration, no new table, no new env var.** Feature is read-only over existing data.
- **No request-time AI.** The only Claude call is the one-time `scripts/generate-eras.mjs`. The deployed app just reads committed `eras.data.ts`.
- **Public pages read `confirmed` only:** server components use `getServerSupabase()` (service-role) with an explicit `.eq("review_status","confirmed")` filter (RLS is bypassed by service-role, so filter manually — mirror `src/app/photos/page.tsx`).
- **Shared classifier/era logic lives in `.mjs`** (like `src/lib/zone-classifier.mjs`) so the app, tests, and node scripts import one copy. TypeScript types live in `.ts` modules.
- **`plants`/`tags` are search-only** — never rendered as chips (locked design decision).
- **Anthropic SDK direct** (`@anthropic-ai/sdk`), model `claude-sonnet-4-6`, structured output via `output_config: { format: { type: "json_schema", schema } }`. Not the Vercel AI Gateway.
- **Test commands:** `npm test` (vitest run) for the suite; `npx vitest run <path>` for one file.
- **Reuse existing helpers:** `publicPhotoUrl`/`sortChronological` (`src/lib/photos.ts`), `getExifDateTaken` is not needed here. `AREA_ORDER`/`AREA_LABELS` (`src/lib/zones.ts`).
- **Commit after every task.** End commit messages with the repo's Co-Authored-By trailer.

---

## Phase A — Foundations + ZonePanel lightbox enrichment

### Task A1: Bloom-color normalization (`photo-facets.ts` — first slice)

**Files:**
- Create: `src/lib/photo-facets.ts`
- Test: `tests/photo-facets.test.ts`

**Interfaces:**
- Produces: `type CanonicalColor`, `CANONICAL_COLORS: { key: CanonicalColor; label: string; hex: string }[]`, `normalizeBloomColor(raw: string): CanonicalColor | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/photo-facets.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBloomColor, CANONICAL_COLORS } from "../src/lib/photo-facets";

describe("normalizeBloomColor", () => {
  it("maps exact canonical names", () => {
    expect(normalizeBloomColor("pink")).toBe("pink");
    expect(normalizeBloomColor("Purple")).toBe("purple");
  });
  it("maps variants via keywords", () => {
    expect(normalizeBloomColor("light pink")).toBe("pink");
    expect(normalizeBloomColor("deep reddish-purple")).toBe("purple");
    expect(normalizeBloomColor("pale yellow / cream")).toBe("yellow");
    expect(normalizeBloomColor("lavender")).toBe("purple");
  });
  it("returns null for empty / none / unmappable noise", () => {
    expect(normalizeBloomColor("")).toBeNull();
    expect(normalizeBloomColor("none")).toBeNull();
    expect(normalizeBloomColor("n/a")).toBeNull();
    expect(normalizeBloomColor("variegated foliage")).toBeNull();
  });
  it("exposes a swatch hex for every canonical color", () => {
    for (const c of CANONICAL_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/photo-facets.test.ts`
Expected: FAIL — "Failed to resolve import ... src/lib/photo-facets".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/photo-facets.ts
export type CanonicalColor =
  | "pink" | "red" | "purple" | "blue" | "white" | "yellow"
  | "orange" | "green" | "coral" | "magenta" | "cream";

export const CANONICAL_COLORS: { key: CanonicalColor; label: string; hex: string }[] = [
  { key: "pink", label: "Pink", hex: "#e58bb0" },
  { key: "red", label: "Red", hex: "#c0392b" },
  { key: "purple", label: "Purple", hex: "#7b5aa6" },
  { key: "blue", label: "Blue", hex: "#4a72b0" },
  { key: "white", label: "White", hex: "#f2efe6" },
  { key: "yellow", label: "Yellow", hex: "#e5c84a" },
  { key: "orange", label: "Orange", hex: "#e08a3c" },
  { key: "green", label: "Green", hex: "#6f8150" },
  { key: "coral", label: "Coral", hex: "#e5795b" },
  { key: "magenta", label: "Magenta", hex: "#c1447e" },
  { key: "cream", label: "Cream", hex: "#eadfc0" },
];

// Keyword → canonical. First match wins; order matters (specific before generic).
const KEYWORDS: [string, CanonicalColor][] = [
  ["lavender", "purple"], ["violet", "purple"], ["lilac", "purple"], ["mauve", "purple"], ["purple", "purple"],
  ["magenta", "magenta"], ["fuchsia", "magenta"],
  ["coral", "coral"], ["salmon", "coral"], ["peach", "coral"],
  ["cream", "cream"], ["ivory", "cream"], ["off-white", "cream"],
  ["pink", "pink"], ["rose", "pink"],
  ["red", "red"], ["crimson", "red"], ["scarlet", "red"], ["burgundy", "red"],
  ["orange", "orange"], ["apricot", "orange"],
  ["yellow", "yellow"], ["gold", "yellow"],
  ["blue", "blue"], ["indigo", "blue"],
  ["white", "white"],
  ["green", "green"], ["chartreuse", "green"],
];

const NULLISH = new Set(["", "none", "n/a", "na", "unknown", "no blooms", "foliage"]);

export function normalizeBloomColor(raw: string): CanonicalColor | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || NULLISH.has(s)) return null;
  for (const [kw, canon] of KEYWORDS) if (s.includes(kw)) return canon;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/photo-facets.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/photo-facets.ts tests/photo-facets.test.ts
git commit -m "feat: bloom-color normalization for photo enrichment"
```

---

### Task A2: `PhotoMeta` enrichment panel

**Files:**
- Create: `src/components/PhotoMeta.tsx`
- Test: `tests/photo-meta.test.tsx`

**Interfaces:**
- Consumes: `normalizeBloomColor`, `CANONICAL_COLORS` (Task A1).
- Produces:
  ```ts
  export type PhotoMetaProps = {
    caption: string | null;
    takenAt: string | null;      // ISO or null
    zoneName: string | null;
    eraTitle?: string | null;    // omitted/blank until Phase C
    quality?: "good" | "ok" | "poor" | null;
    bloomColors?: string[];      // raw strings; normalized inside
    reasoning?: string | null;   // rendered inside collapsible "AI Summary"
  };
  export default function PhotoMeta(props: PhotoMetaProps): JSX.Element;
  ```
- **Design lock:** never render `plants`/`tags`. No prop for them exists.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/photo-meta.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PhotoMeta from "../src/components/PhotoMeta";

describe("PhotoMeta", () => {
  it("shows caption, zone, quality and normalized bloom swatches", () => {
    render(
      <PhotoMeta
        caption="View across the pool."
        takenAt="2024-10-17T16:45:50Z"
        zoneName="Pool & Spa"
        quality="good"
        bloomColors={["light pink", "lavender"]}
        reasoning="Kidney pool visible."
      />,
    );
    expect(screen.getByText("View across the pool.")).toBeInTheDocument();
    expect(screen.getByText(/Pool & Spa/)).toBeInTheDocument();
    expect(screen.getByText(/good/i)).toBeInTheDocument();
    // pink + purple (lavender→purple), de-duped
    expect(screen.getByLabelText("Pink")).toBeInTheDocument();
    expect(screen.getByLabelText("Purple")).toBeInTheDocument();
  });

  it("hides the AI Summary body by default (details collapsed)", () => {
    render(<PhotoMeta caption="c" takenAt={null} zoneName={null} reasoning="secret reasoning" />);
    const summary = screen.getByText(/AI Summary/i);
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("omits sections with no data and never renders plants/tags", () => {
    render(<PhotoMeta caption="just a caption" takenAt={null} zoneName={null} />);
    expect(screen.queryByText(/Blooming/i)).toBeNull();
    expect(screen.queryByText(/AI Summary/i)).toBeNull();
    expect(screen.queryByText(/salvia/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/photo-meta.test.tsx`
Expected: FAIL — cannot resolve `../src/components/PhotoMeta`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/PhotoMeta.tsx
import { normalizeBloomColor, CANONICAL_COLORS, type CanonicalColor } from "@/lib/photo-facets";

export type PhotoMetaProps = {
  caption: string | null;
  takenAt: string | null;
  zoneName: string | null;
  eraTitle?: string | null;
  quality?: "good" | "ok" | "poor" | null;
  bloomColors?: string[];
  reasoning?: string | null;
};

const swatch = (c: CanonicalColor) => CANONICAL_COLORS.find((x) => x.key === c)!;

export default function PhotoMeta(props: PhotoMetaProps) {
  const { caption, takenAt, zoneName, eraTitle, quality, bloomColors, reasoning } = props;

  const blooms = Array.from(
    new Set((bloomColors ?? []).map(normalizeBloomColor).filter((c): c is CanonicalColor => c !== null)),
  );
  const dateStr = takenAt ? new Date(takenAt).toLocaleDateString() : null;
  const facts = [dateStr, zoneName, eraTitle].filter(Boolean).join(" · ");

  return (
    <div style={{ padding: "12px 14px", color: "#3f4a2e" }}>
      {caption && <p style={{ fontSize: 14, lineHeight: 1.4, margin: "0 0 8px" }}>{caption}</p>}
      {(facts || quality) && (
        <p style={{ fontSize: 12, color: "#8a8268", margin: "0 0 10px" }}>
          {facts}
          {quality && (
            <span style={{ marginLeft: facts ? 8 : 0, background: "#dce8cf", color: "#4a5a2e", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
              {quality}
            </span>
          )}
        </p>
      )}
      {blooms.length > 0 && (
        <>
          <p style={{ fontSize: 9, letterSpacing: ".09em", color: "#8a8268", textTransform: "uppercase", margin: "10px 0 4px" }}>Blooming</p>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {blooms.map((c) => {
              const s = swatch(c);
              return (
                <span key={c} title={s.label} aria-label={s.label}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#5a5340" }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid #00000022", background: s.hex }} />
                  {s.label}
                </span>
              );
            })}
          </div>
        </>
      )}
      {reasoning && (
        <details style={{ marginTop: 10, borderTop: "1px dashed #cbb994", paddingTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "#8e3b5e", fontSize: 11 }}>AI Summary</summary>
          <p style={{ color: "#6a6350", fontSize: 11, margin: "6px 0 0", lineHeight: 1.4 }}>{reasoning}</p>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/photo-meta.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PhotoMeta.tsx tests/photo-meta.test.tsx
git commit -m "feat: PhotoMeta shared enrichment panel (caption/blooms/AI summary)"
```

---

### Task A3: `PhotoLightbox` shared viewer

**Files:**
- Create: `src/components/PhotoLightbox.tsx`
- Test: `tests/photo-lightbox.test.tsx`

**Interfaces:**
- Consumes: `PhotoMeta`, `PhotoMetaProps` (Task A2).
- Produces:
  ```ts
  export type PhotoLightboxProps = { src: string; alt: string; meta: PhotoMetaProps; onClose: () => void };
  export default function PhotoLightbox(props: PhotoLightboxProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/photo-lightbox.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhotoLightbox from "../src/components/PhotoLightbox";

describe("PhotoLightbox", () => {
  const meta = { caption: "A caption", takenAt: null, zoneName: "Pool & Spa" };

  it("renders the image and the meta panel", () => {
    render(<PhotoLightbox src="https://x/y.jpg" alt="alt text" meta={meta} onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "alt text" })).toBeInTheDocument();
    expect(screen.getByText("A caption")).toBeInTheDocument();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="https://x/y.jpg" alt="a" meta={meta} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/photo-lightbox.test.tsx`
Expected: FAIL — cannot resolve `../src/components/PhotoLightbox`.

- [ ] **Step 3: Write minimal implementation**

Extract from `ZonePanel`'s inline lightbox (`ZonePanel.tsx:223-243`), adding the meta panel. Desktop = image + side panel (flex row); mobile stacks (flex-wrap).

```tsx
// src/components/PhotoLightbox.tsx
"use client";
import PhotoMeta, { type PhotoMetaProps } from "./PhotoMeta";

export type PhotoLightboxProps = { src: string; alt: string; meta: PhotoMetaProps; onClose: () => void };

export default function PhotoLightbox({ src, alt, meta, onClose }: PhotoLightboxProps) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#f5efe0", borderRadius: 10, overflow: "hidden", maxWidth: "min(94vw, 900px)", maxHeight: "92vh", display: "flex", flexWrap: "wrap" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} style={{ flex: "1 1 320px", minWidth: 260, maxHeight: "92vh", objectFit: "contain", background: "#000", display: "block" }} />
        <div style={{ flex: "1 1 240px", maxWidth: 340, overflowY: "auto", maxHeight: "92vh" }}>
          <PhotoMeta {...meta} />
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close photo"
        style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", fontSize: 24, lineHeight: 1, cursor: "pointer", borderRadius: 4, width: 40, height: 40 }}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/photo-lightbox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PhotoLightbox.tsx tests/photo-lightbox.test.tsx
git commit -m "feat: PhotoLightbox shared full-screen viewer with meta panel"
```

---

### Task A4: Wire `ZonePanel` to the shared lightbox

**Files:**
- Modify: `src/components/ZonePanel.tsx` (replace inline lightbox at lines ~223-243; keep `lightboxPhoto` state and the thumbnail `onClick`).
- Test: reuse `tests/photos-tabs.test.tsx` style is not needed; verify via existing suite + preview.

**Interfaces:**
- Consumes: `PhotoLightbox` (Task A3). Builds `PhotoMetaProps` from a `ZonePhoto` + the current `zone.name`.

- [ ] **Step 1: Add the import and a meta-builder, replace the inline lightbox**

Add import near the top of `ZonePanel.tsx` (with the other component imports):

```tsx
import PhotoLightbox from "./PhotoLightbox";
```

Replace the entire inline lightbox block (currently `{lightboxPhoto && ( <div ...full-screen...> ... </div> )}`, `ZonePanel.tsx:223-243`) with:

```tsx
      {lightboxPhoto && (
        <PhotoLightbox
          src={publicPhotoUrl(SUPABASE_URL, lightboxPhoto.storage_path)}
          alt={lightboxPhoto.caption ?? `${zone.name} photo`}
          onClose={() => setLightboxPhoto(null)}
          meta={{
            caption: lightboxPhoto.caption,
            takenAt: lightboxPhoto.taken_at,
            zoneName: zone.name,
            quality: lightboxPhoto.ai_meta?.quality ?? null,
            bloomColors: lightboxPhoto.ai_meta?.botanical?.bloom_colors ?? [],
            reasoning: lightboxPhoto.ai_meta?.reasoning ?? null,
          }}
        />
      )}
```

- [ ] **Step 2: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS (existing ZonePanel-adjacent tests unaffected; new component tests pass).

- [ ] **Step 3: Manual preview**

Start the dev server (via the preview tooling, not raw `next dev`), open the map, tap a zone with photos, tap a photo. Confirm: image + caption + (if present) bloom swatches + collapsible "AI Summary" appear; closing works.

- [ ] **Step 4: Commit**

```bash
git add src/components/ZonePanel.tsx
git commit -m "feat: ZonePanel uses shared PhotoLightbox with enrichment"
```

---

## Phase B — Filterable gallery (`/gallery`)

### Task B1: Era primitives (`eras.mjs`) + committed stub (`eras.data.ts`)

**Files:**
- Create: `src/lib/eras.mjs`
- Create: `src/lib/eras.data.ts`
- Test: `tests/eras.test.ts`

**Interfaces:**
- Produces (from `eras.mjs`, ESM, JSDoc-typed):
  - `MILESTONE_KEYS: string[]` = `["stock_tank","raised_beds","cedar_planters","vines","cover_crop_field"]`
  - `MILESTONES: { key: string; label: string; icon: string }[]`
  - `seasonYear(dateISO: string): { season: "winter"|"spring"|"summer"|"fall"; year: number }`
  - `assignEra(dateISO: string, eras: { key: string; start: string; end: string | null }[]): string | null`
- Produces (from `eras.data.ts`, TS):
  - `export type MilestoneKey = "stock_tank" | "raised_beds" | "cedar_planters" | "vines" | "cover_crop_field";`
  - `export type EraContent = { key: string; title: string; blurb: string; milestones: MilestoneKey[]; start: string; end: string | null; coverPath: string | null; generatedAt: string; model: string };`
  - `export const ERAS: EraContent[] = [];` (empty stub; Phase C regenerates)

- [ ] **Step 1: Write the failing test**

```ts
// tests/eras.test.ts
import { describe, it, expect } from "vitest";
import { MILESTONE_KEYS, MILESTONES, seasonYear, assignEra } from "../src/lib/eras.mjs";

describe("era primitives", () => {
  it("enumerates the five hardscape milestones with labels + icons", () => {
    expect(MILESTONE_KEYS).toContain("raised_beds");
    expect(MILESTONE_KEYS).toHaveLength(5);
    expect(MILESTONES.find((m) => m.key === "raised_beds")?.label).toBeTruthy();
  });

  it("derives season and year from a date", () => {
    expect(seasonYear("2025-04-13T00:00:00Z")).toEqual({ season: "spring", year: 2025 });
    expect(seasonYear("2024-12-05T00:00:00Z")).toEqual({ season: "winter", year: 2024 });
    expect(seasonYear("2025-07-01T00:00:00Z")).toEqual({ season: "summer", year: 2025 });
    expect(seasonYear("2024-10-17T00:00:00Z")).toEqual({ season: "fall", year: 2024 });
  });

  it("assigns a date to the era whose [start,end) contains it", () => {
    const eras = [
      { key: "era-0", start: "2024-10-01", end: "2025-04-13" },
      { key: "era-1", start: "2025-04-13", end: null },
    ];
    expect(assignEra("2024-11-01", eras)).toBe("era-0");
    expect(assignEra("2025-04-13", eras)).toBe("era-1");
    expect(assignEra("2026-01-01", eras)).toBe("era-1");
  });

  it("returns null when there are no eras", () => {
    expect(assignEra("2025-01-01", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eras.test.ts`
Expected: FAIL — cannot resolve `../src/lib/eras.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/eras.mjs
// Deterministic era engine. Shared by the app (runtime helpers), tests, and
// scripts/generate-eras.mjs (Phase C adds detection/build here). Plain ESM so a
// node script can import it — mirrors src/lib/zone-classifier.mjs.

export const MILESTONE_KEYS = ["stock_tank", "raised_beds", "cedar_planters", "vines", "cover_crop_field"];

export const MILESTONES = [
  { key: "stock_tank", label: "Stock tank", icon: "🛢" },
  { key: "raised_beds", label: "Raised beds", icon: "🛏" },
  { key: "cedar_planters", label: "Cedar planters", icon: "🌲" },
  { key: "vines", label: "Vines", icon: "🌿" },
  { key: "cover_crop_field", label: "Cover-crop field", icon: "🌾" },
];

/** Northern-hemisphere season + calendar year. */
export function seasonYear(dateISO) {
  const d = new Date(dateISO);
  const m = d.getUTCMonth(); // 0-11
  const season = m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "fall";
  return { season, year: d.getUTCFullYear() };
}

/** Era key whose [start, end) contains the date; last era's null end = ongoing. */
export function assignEra(dateISO, eras) {
  if (!eras || eras.length === 0) return null;
  for (const e of eras) {
    if (dateISO >= e.start && (e.end === null || dateISO < e.end)) return e.key;
  }
  // Before the first era's start → defensively bucket into the first era.
  return dateISO < eras[0].start ? eras[0].key : eras[eras.length - 1].key;
}
```

```ts
// src/lib/eras.data.ts
// Generated by scripts/generate-eras.mjs (Phase C). Committed empty stub so the
// gallery/timeline compile before the generator runs; ERAS = [] → no era facet.
export type MilestoneKey = "stock_tank" | "raised_beds" | "cedar_planters" | "vines" | "cover_crop_field";

export type EraContent = {
  key: string;
  title: string;
  blurb: string;
  milestones: MilestoneKey[];
  start: string;
  end: string | null;
  coverPath: string | null;
  generatedAt: string;
  model: string;
};

export const ERAS: EraContent[] = [];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/eras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eras.mjs src/lib/eras.data.ts tests/eras.test.ts
git commit -m "feat: era primitives (season/assign) + empty eras.data stub"
```

---

### Task B2: Facet derivation, filtering & search (`photo-facets.ts` — full)

**Files:**
- Modify: `src/lib/photo-facets.ts` (append; keep Task A1 exports)
- Modify: `tests/photo-facets.test.ts` (append)

**Interfaces:**
- Consumes: `normalizeBloomColor` (A1); `MILESTONE_KEYS`, `assignEra`, `seasonYear` (B1, from `eras.mjs`); `EraContent`, `MilestoneKey` (B1, from `eras.data`); `Zone`, `ZonePhoto`, `AiMeta` (`src/lib/types`).
- Produces:
  ```ts
  export type MilestoneKey = ... // re-exported from eras.data for convenience
  export type PhotoFacet = {
    id: string; storagePath: string; takenAt: string | null;
    zoneId: string | null; zoneName: string | null; area: Area | null;
    quality: "good" | "ok" | "poor" | null;
    caption: string | null; reasoning: string | null;
    bloomColors: CanonicalColor[]; milestones: MilestoneKey[];
    eraKey: string | null; season: string; year: number;
    searchText: string;
  };
  export type Filters = {
    areas: Area[]; zoneIds: string[]; eraKeys: string[];
    seasonYears: string[]; // "spring-2025"
    milestones: MilestoneKey[]; bloom: CanonicalColor[]; quality: string[]; text: string;
  };
  export const EMPTY_FILTERS: Filters;
  export function deriveFacet(photo: ZonePhoto, zones: Zone[], eras: EraContent[]): PhotoFacet;
  export function matchesFilters(f: PhotoFacet, filters: Filters): boolean;
  export function availableFacets(facets: PhotoFacet[]): {
    areas: { value: Area; count: number }[];
    zones: { value: string; label: string; count: number }[];
    eras: { value: string; label: string; count: number }[];
    seasonYears: { value: string; label: string; count: number }[];
    milestones: { value: MilestoneKey; label: string; count: number }[];
    bloom: { value: CanonicalColor; count: number }[];
    quality: { value: string; count: number }[];
  };
  ```

- [ ] **Step 1: Write the failing tests (append to `tests/photo-facets.test.ts`)**

```ts
import { deriveFacet, matchesFilters, availableFacets, EMPTY_FILTERS } from "../src/lib/photo-facets";
import type { Zone, ZonePhoto } from "../src/lib/types";
import type { EraContent } from "../src/lib/eras.data";

const zones = [{ id: "z-pool", slug: "pool-spa", name: "Pool & Spa", area: "pool" }] as unknown as Zone[];
const eras: EraContent[] = [
  { key: "era-0", title: "Before", blurb: "", milestones: [], start: "2024-01-01", end: "2025-04-13", coverPath: null, generatedAt: "", model: "" },
  { key: "era-1", title: "Build-Out", blurb: "", milestones: ["raised_beds"], start: "2025-04-13", end: null, coverPath: null, generatedAt: "", model: "" },
];
const photo = (over: Partial<ZonePhoto>): ZonePhoto =>
  ({ id: "p", zone_id: "z-pool", storage_path: "z-pool/a.jpg", caption: "pink salvia by the pool",
     taken_at: "2025-05-01T00:00:00Z", uploaded_at: "2025-05-02T00:00:00Z", sort_order: 0, area: "pool",
     review_status: "confirmed", source: "batch_import", source_ref: null, ai_zone_slug: "pool-spa",
     ai_area: "pool", ai_confidence: 0.9, ai_model: "m", is_yard: true,
     ai_meta: { quality: "good", reasoning: "kidney pool", tags: ["pool"], plants: ["salvia"],
       hardscape: { raised_beds: true, stock_tank: false, cedar_planters: false, vines: false, cover_crop_field: false },
       botanical: { bloom_colors: ["light pink"] } }, ...over }) as ZonePhoto;

describe("deriveFacet", () => {
  const f = deriveFacet(photo({}), zones, eras);
  it("resolves zone, area, quality, bloom, milestone, era, season", () => {
    expect(f.zoneName).toBe("Pool & Spa");
    expect(f.quality).toBe("good");
    expect(f.bloomColors).toEqual(["pink"]);
    expect(f.milestones).toEqual(["raised_beds"]);
    expect(f.eraKey).toBe("era-1");
    expect(f.season).toBe("spring");
    expect(f.year).toBe(2025);
  });
  it("builds a lowercased searchText from caption + tags + plants", () => {
    expect(f.searchText).toContain("salvia");
    expect(f.searchText).toContain("pool");
  });
  it("tolerates empty ai_meta", () => {
    const g = deriveFacet(photo({ ai_meta: {} }), zones, eras);
    expect(g.bloomColors).toEqual([]);
    expect(g.milestones).toEqual([]);
    expect(g.quality).toBeNull();
  });
});

describe("matchesFilters", () => {
  const f = deriveFacet(photo({}), zones, eras);
  it("passes with empty filters", () => expect(matchesFilters(f, EMPTY_FILTERS)).toBe(true));
  it("filters by area (AND across dimensions)", () => {
    expect(matchesFilters(f, { ...EMPTY_FILTERS, areas: ["pool"] })).toBe(true);
    expect(matchesFilters(f, { ...EMPTY_FILTERS, areas: ["front"] })).toBe(false);
  });
  it("filters by bloom (OR within a dimension)", () => {
    expect(matchesFilters(f, { ...EMPTY_FILTERS, bloom: ["pink", "red"] })).toBe(true);
    expect(matchesFilters(f, { ...EMPTY_FILTERS, bloom: ["blue"] })).toBe(false);
  });
  it("filters by free text over searchText", () => {
    expect(matchesFilters(f, { ...EMPTY_FILTERS, text: "salvia" })).toBe(true);
    expect(matchesFilters(f, { ...EMPTY_FILTERS, text: "cactus" })).toBe(false);
  });
});

describe("availableFacets", () => {
  it("counts distinct values per dimension", () => {
    const facets = [deriveFacet(photo({ id: "a" }), zones, eras), deriveFacet(photo({ id: "b" }), zones, eras)];
    const a = availableFacets(facets);
    expect(a.areas).toEqual([{ value: "pool", count: 2 }]);
    expect(a.bloom).toEqual([{ value: "pink", count: 2 }]);
    expect(a.eras.find((e) => e.value === "era-1")?.count).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/photo-facets.test.ts`
Expected: FAIL — `deriveFacet` etc. not exported.

- [ ] **Step 3: Append the implementation to `src/lib/photo-facets.ts`**

```ts
// --- appended below Task A1 exports ---
import type { Area, Zone, ZonePhoto } from "./types";
import type { EraContent, MilestoneKey } from "./eras.data";
import { MILESTONE_KEYS, assignEra, seasonYear } from "./eras.mjs";

export type { MilestoneKey };

export type PhotoFacet = {
  id: string; storagePath: string; takenAt: string | null;
  zoneId: string | null; zoneName: string | null; area: Area | null;
  quality: "good" | "ok" | "poor" | null;
  caption: string | null; reasoning: string | null;
  bloomColors: CanonicalColor[]; milestones: MilestoneKey[];
  eraKey: string | null; season: string; year: number;
  searchText: string;
};

export type Filters = {
  areas: Area[]; zoneIds: string[]; eraKeys: string[]; seasonYears: string[];
  milestones: MilestoneKey[]; bloom: CanonicalColor[]; quality: string[]; text: string;
};

export const EMPTY_FILTERS: Filters = {
  areas: [], zoneIds: [], eraKeys: [], seasonYears: [], milestones: [], bloom: [], quality: [], text: "",
};

export function deriveFacet(photo: ZonePhoto, zones: Zone[], eras: EraContent[]): PhotoFacet {
  const zone = zones.find((z) => z.id === photo.zone_id) ?? null;
  const meta = photo.ai_meta ?? {};
  const hardscape = (meta.hardscape ?? {}) as Record<string, boolean>;
  const milestones = MILESTONE_KEYS.filter((k) => hardscape[k] === true) as MilestoneKey[];
  const bloomColors = Array.from(
    new Set((meta.botanical?.bloom_colors ?? []).map(normalizeBloomColor).filter((c): c is CanonicalColor => c !== null)),
  );
  const date = photo.taken_at ?? photo.uploaded_at;
  const { season, year } = seasonYear(date);
  const searchText = [photo.caption, ...(meta.tags ?? []), ...(meta.plants ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  return {
    id: photo.id, storagePath: photo.storage_path, takenAt: photo.taken_at,
    zoneId: photo.zone_id, zoneName: zone?.name ?? null, area: zone?.area ?? photo.area ?? null,
    quality: (meta.quality as PhotoFacet["quality"]) ?? null,
    caption: photo.caption, reasoning: (meta.reasoning as string) ?? null,
    bloomColors, milestones,
    eraKey: assignEra(date, eras), season, year, searchText,
  };
}

const seasonYearKey = (f: PhotoFacet) => `${f.season}-${f.year}`;

export function matchesFilters(f: PhotoFacet, x: Filters): boolean {
  if (x.areas.length && (!f.area || !x.areas.includes(f.area))) return false;
  if (x.zoneIds.length && (!f.zoneId || !x.zoneIds.includes(f.zoneId))) return false;
  if (x.eraKeys.length && (!f.eraKey || !x.eraKeys.includes(f.eraKey))) return false;
  if (x.seasonYears.length && !x.seasonYears.includes(seasonYearKey(f))) return false;
  if (x.milestones.length && !x.milestones.some((m) => f.milestones.includes(m))) return false;
  if (x.bloom.length && !x.bloom.some((b) => f.bloomColors.includes(b))) return false;
  if (x.quality.length && (!f.quality || !x.quality.includes(f.quality))) return false;
  if (x.text.trim() && !f.searchText.includes(x.text.trim().toLowerCase())) return false;
  return true;
}

function tally<T extends string>(rows: PhotoFacet[], pick: (f: PhotoFacet) => T[] | T | null) {
  const counts = new Map<T, number>();
  for (const f of rows) {
    const v = pick(f);
    const vals = Array.isArray(v) ? v : v == null ? [] : [v];
    for (const x of vals) counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return counts;
}

export function availableFacets(facets: PhotoFacet[]) {
  const seasonLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace("-", " ");
  const zoneName = (id: string) => facets.find((f) => f.zoneId === id)?.zoneName ?? id;
  const toRows = <T extends string>(m: Map<T, number>, label?: (v: T) => string) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) =>
      label ? { value, label: label(value), count } : { value, count });
  return {
    areas: toRows(tally(facets, (f) => f.area)) as { value: Area; count: number }[],
    zones: toRows(tally(facets, (f) => f.zoneId), zoneName) as { value: string; label: string; count: number }[],
    eras: toRows(tally(facets, (f) => f.eraKey)) as { value: string; count: number }[],
    seasonYears: toRows(tally(facets, seasonYearKey), seasonLabel) as { value: string; label: string; count: number }[],
    milestones: toRows(tally(facets, (f) => f.milestones)) as { value: MilestoneKey; count: number }[],
    bloom: toRows(tally(facets, (f) => f.bloomColors)) as { value: CanonicalColor; count: number }[],
    quality: toRows(tally(facets, (f) => f.quality)) as { value: string; count: number }[],
  };
}
```

> Note: `zones`/`seasonYears` carry a precomputed `label` (the UI lacks the zone list and needs the season prettified); `areas`/`eras`/`milestones`/`bloom`/`quality` return `value`+`count` only — the UI derives their labels from `AREA_LABELS` / `ERAS` / `MILESTONES` / `CANONICAL_COLORS` / capitalization.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/photo-facets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/photo-facets.ts tests/photo-facets.test.ts
git commit -m "feat: photo facet derivation, filtering, search, and counts"
```

---

### Task B3: Gallery server page (compact projection loader)

**Files:**
- Create: `src/app/gallery/page.tsx`
- Create: `src/app/gallery/GalleryBrowser.tsx` (stub rendered here; filled in B4)

**Interfaces:**
- Consumes: `getServerSupabase`, `deriveFacet`, `ERAS`, `Zone`/`ZonePhoto` types.
- Produces: default-exported async server component; passes `facets: PhotoFacet[]` + `available` + `zones`-derived labels to `GalleryBrowser`.

- [ ] **Step 1: Read the Next.js docs for server-component data loading**

Read `node_modules/next/dist/docs/` sections on server components / data fetching before writing this file (per Global Constraints). Note the App-Router page signature this repo's version expects.

- [ ] **Step 2: Create a minimal `GalleryBrowser` stub so the page compiles**

```tsx
// src/app/gallery/GalleryBrowser.tsx
"use client";
import type { PhotoFacet } from "@/lib/photo-facets";

export default function GalleryBrowser({ facets }: { facets: PhotoFacet[] }) {
  return <div data-testid="gallery-count">{facets.length} photos</div>;
}
```

- [ ] **Step 3: Create the server page**

Load all confirmed photos (page through PostgREST's 1000-row cap, like `import-photos.mjs:69-78`), map to facets, hand to the client.

```tsx
// src/app/gallery/page.tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { deriveFacet, type PhotoFacet } from "@/lib/photo-facets";
import { ERAS } from "@/lib/eras.data";
import type { Zone, ZonePhoto } from "@/lib/types";
import GalleryBrowser from "./GalleryBrowser";

export const dynamic = "force-dynamic";

async function loadConfirmed(sb: ReturnType<typeof getServerSupabase>): Promise<ZonePhoto[]> {
  const out: ZonePhoto[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("zone_photos").select("*")
      .eq("review_status", "confirmed")
      .order("taken_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ZonePhoto[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default async function GalleryPage() {
  const sb = getServerSupabase();
  const [{ data: zones }, photos] = await Promise.all([
    sb.from("zones").select("*"),
    loadConfirmed(sb),
  ]);
  const facets: PhotoFacet[] = photos.map((p) => deriveFacet(p, (zones ?? []) as Zone[], ERAS));
  return <GalleryBrowser facets={facets} />;
}
```

- [ ] **Step 4: Verify build/typecheck & preview**

Run: `npx tsc --noEmit` (expected: no errors in the new files).
Then preview `/gallery` and confirm it renders "N photos" with a plausible N (~1,900).

- [ ] **Step 5: Commit**

```bash
git add src/app/gallery/page.tsx src/app/gallery/GalleryBrowser.tsx
git commit -m "feat: /gallery server page loads confirmed photos as facet projection"
```

---

### Task B4: `GalleryBrowser` — grouped chips, grid, lightbox

**Files:**
- Modify: `src/app/gallery/GalleryBrowser.tsx`
- Test: `tests/gallery-browser.test.tsx`

**Interfaces:**
- Consumes: `Filters`, `EMPTY_FILTERS`, `matchesFilters`, `availableFacets`, `CANONICAL_COLORS` (photo-facets); `MILESTONES` (eras.mjs); `ERAS` (eras.data); `AREA_LABELS` (zones); `publicPhotoUrl` (photos); `PhotoLightbox` (A3).
- Renders grouped filter chips (Area / Era / Season / Milestone / Bloom / Quality) + search box + result count + responsive grid; tapping a thumb opens `PhotoLightbox` built from the facet.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/gallery-browser.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import GalleryBrowser from "../src/app/gallery/GalleryBrowser";
import type { PhotoFacet } from "../src/lib/photo-facets";

const f = (over: Partial<PhotoFacet>): PhotoFacet =>
  ({ id: "p", storagePath: "z/a.jpg", takenAt: "2025-05-01T00:00:00Z", zoneId: "z-pool",
     zoneName: "Pool & Spa", area: "pool", quality: "good", caption: "pink salvia",
     reasoning: null, bloomColors: ["pink"], milestones: ["raised_beds"], eraKey: "era-1",
     season: "spring", year: 2025, searchText: "pink salvia", ...over }) as PhotoFacet;

describe("GalleryBrowser", () => {
  const facets = [
    f({ id: "a", area: "pool", bloomColors: ["pink"] }),
    f({ id: "b", area: "front", zoneName: "Hellstrip", zoneId: "z-hell", bloomColors: ["yellow"], searchText: "yellow lantana" }),
  ];

  it("shows the total count initially", () => {
    render(<GalleryBrowser facets={facets} />);
    expect(screen.getByText(/2 photos/i)).toBeInTheDocument();
  });

  it("narrows results when an area chip is toggled", () => {
    render(<GalleryBrowser facets={facets} />);
    fireEvent.click(within(screen.getByTestId("facet-area")).getByRole("button", { name: /front/i }));
    expect(screen.getByText(/1 photo/i)).toBeInTheDocument();
  });

  it("filters by free-text search", () => {
    render(<GalleryBrowser facets={facets} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "lantana" } });
    expect(screen.getByText(/1 photo/i)).toBeInTheDocument();
  });

  it("clears filters", () => {
    render(<GalleryBrowser facets={facets} />);
    fireEvent.click(within(screen.getByTestId("facet-area")).getByRole("button", { name: /front/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByText(/2 photos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/gallery-browser.test.tsx`
Expected: FAIL (stub renders only a count `div`, no chips/search).

- [ ] **Step 3: Implement `GalleryBrowser`**

```tsx
// src/app/gallery/GalleryBrowser.tsx
"use client";
import { useMemo, useState } from "react";
import Image from "next/image";
import {
  type PhotoFacet, type Filters, EMPTY_FILTERS, matchesFilters, availableFacets,
  CANONICAL_COLORS, type CanonicalColor, type MilestoneKey,
} from "@/lib/photo-facets";
import { MILESTONES } from "@/lib/eras.mjs";
import { ERAS } from "@/lib/eras.data";
import { AREA_LABELS } from "@/lib/zones";
import { publicPhotoUrl } from "@/lib/photos";
import PhotoLightbox from "@/components/PhotoLightbox";
import type { Area } from "@/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      border: "1px solid " + (on ? "#8e3b5e" : "#cbb994"), borderRadius: 999, padding: "3px 10px",
      fontSize: 11, margin: "0 5px 5px 0", cursor: "pointer",
      background: on ? "#8e3b5e" : "#efe7d3", color: on ? "#fff" : "#5a5340",
    }}>{children}</button>
  );
}

export default function GalleryBrowser({ facets }: { facets: PhotoFacet[] }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [open, setOpen] = useState<PhotoFacet | null>(null);
  const available = useMemo(() => availableFacets(facets), [facets]);
  const shown = useMemo(() => facets.filter((f) => matchesFilters(f, filters)), [facets, filters]);

  // key is any array-valued Filters field; value toggles membership.
  const toggle = (key: Exclude<keyof Filters, "text">, value: string) =>
    setFilters((prev) => {
      const arr = prev[key] as string[];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: next } as Filters;
    });

  const eraLabel = (key: string) => ERAS.find((e) => e.key === key)?.title ?? key;
  const msLabel = (key: string) => MILESTONES.find((m) => m.key === key);
  const colorHex = (c: CanonicalColor) => CANONICAL_COLORS.find((x) => x.key === c)!;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const groupLabel: React.CSSProperties = { fontSize: 9, letterSpacing: ".09em", color: "#8a8268", textTransform: "uppercase", margin: "6px 6px 2px 0", display: "inline-block", width: 52 };

  return (
    <div style={{ padding: 12, paddingBottom: 72 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input
          placeholder="search plants, tags, captions…"
          value={filters.text}
          onChange={(e) => setFilters((p) => ({ ...p, text: e.target.value }))}
          style={{ flex: 1, height: 30, borderRadius: 8, border: "1px solid #cbb994", padding: "0 10px", fontSize: 12 }}
        />
        <span style={{ fontSize: 12, color: "#5a5340", whiteSpace: "nowrap" }}>
          {shown.length} photo{shown.length === 1 ? "" : "s"}
        </span>
        <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ fontSize: 11, color: "#8e3b5e", background: "none", border: "none", cursor: "pointer" }}>clear</button>
      </div>

      <div data-testid="facet-area" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
        <span style={groupLabel}>Area</span>
        {available.areas.map(({ value, count }) => (
          <Chip key={value} on={filters.areas.includes(value)} onClick={() => toggle("areas", value)}>
            {AREA_LABELS[value as Area]} · {count}
          </Chip>
        ))}
      </div>
      {available.zones.length > 0 && (
        <div data-testid="facet-zone" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Zone</span>
          {available.zones.map(({ value, label, count }) => (
            <Chip key={value} on={filters.zoneIds.includes(value)} onClick={() => toggle("zoneIds", value)}>
              {label} · {count}
            </Chip>
          ))}
        </div>
      )}
      {ERAS.length > 0 && available.eras.length > 0 && (
        <div data-testid="facet-era" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Era</span>
          {available.eras.map(({ value, count }) => (
            <Chip key={value} on={filters.eraKeys.includes(value)} onClick={() => toggle("eraKeys", value)}>
              {eraLabel(value)} · {count}
            </Chip>
          ))}
        </div>
      )}
      <div data-testid="facet-season" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
        <span style={groupLabel}>Season</span>
        {available.seasonYears.map(({ value, label, count }) => (
          <Chip key={value} on={filters.seasonYears.includes(value)} onClick={() => toggle("seasonYears", value)}>
            {label} · {count}
          </Chip>
        ))}
      </div>
      <div data-testid="facet-milestone" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
        <span style={groupLabel}>Built</span>
        {available.milestones.map(({ value, count }) => (
          <Chip key={value} on={filters.milestones.includes(value as MilestoneKey)} onClick={() => toggle("milestones", value)}>
            {msLabel(value)?.icon} {msLabel(value)?.label} · {count}
          </Chip>
        ))}
      </div>
      <div data-testid="facet-bloom" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
        <span style={groupLabel}>Bloom</span>
        {available.bloom.map(({ value, count }) => (
          <Chip key={value} on={filters.bloom.includes(value)} onClick={() => toggle("bloom", value)}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: colorHex(value).hex, marginRight: 4, verticalAlign: -1 }} />
            {colorHex(value).label} · {count}
          </Chip>
        ))}
      </div>
      <div data-testid="facet-quality" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
        <span style={groupLabel}>Quality</span>
        {available.quality.map(({ value, count }) => (
          <Chip key={value} on={filters.quality.includes(value)} onClick={() => toggle("quality", value)}>
            {cap(value)} · {count}
          </Chip>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6, marginTop: 8 }}>
        {shown.map((f) => (
          <button key={f.id} onClick={() => setOpen(f)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
            <Image
              src={publicPhotoUrl(SUPABASE_URL, f.storagePath)}
              alt={f.caption ?? "yard photo"} width={220} height={165} loading="lazy"
              style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, border: "1px solid #cbb994", display: "block" }}
            />
          </button>
        ))}
      </div>

      {open && (
        <PhotoLightbox
          src={publicPhotoUrl(SUPABASE_URL, open.storagePath)}
          alt={open.caption ?? "yard photo"}
          onClose={() => setOpen(null)}
          meta={{
            caption: open.caption, takenAt: open.takenAt, zoneName: open.zoneName,
            eraTitle: open.eraKey ? eraLabel(open.eraKey) : null,
            quality: open.quality, bloomColors: open.bloomColors, reasoning: open.reasoning,
          }}
        />
      )}
    </div>
  );
}
```

> Note: mobile "Filters" collapse (bottom-sheet behind a button) is a presentational refinement — implement after the test passes, keeping the same chip controls inside a toggled panel. Keep the desktop-visible chips for the tests. Free-text search stays always visible.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/gallery-browser.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add mobile filter collapse (presentational)**

Wrap the seven facet `<div>`s in a container that is always shown ≥720px and toggled by a "Filters" button below that width (CSS media query via a `matchMedia` state hook, or a simple `useState` "show filters" toggled button rendered only on narrow screens). Do not change the chip controls (tests must still pass).

- [ ] **Step 6: Run tests again + preview**

Run: `npx vitest run tests/gallery-browser.test.tsx` (PASS), then preview `/gallery`: toggle area+bloom, confirm count + grid update; open a photo → enrichment panel.

- [ ] **Step 7: Commit**

```bash
git add src/app/gallery/GalleryBrowser.tsx tests/gallery-browser.test.tsx
git commit -m "feat: gallery browser — grouped facet chips, grid, lightbox"
```

---

### Task B5: Nav "Gallery" link

**Files:**
- Modify: `src/components/Nav.tsx`
- Modify: `tests/nav.test.tsx`

- [ ] **Step 1: Add the failing test (append to `tests/nav.test.tsx`)**

```tsx
it("renders a public Gallery link", () => {
  render(<EditModeProvider><Nav /></EditModeProvider>);
  expect(screen.getByRole("link", { name: /gallery/i })).toBeDefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/nav.test.tsx`
Expected: FAIL — no Gallery link.

- [ ] **Step 3: Add the link (public, before the edit-only Photos link)**

In `src/components/Nav.tsx`, after the Tracker link:

```tsx
      <Link href="/gallery" style={item}>Gallery</Link>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Nav.tsx tests/nav.test.tsx
git commit -m "feat: public Gallery nav link"
```

---

## Phase C — Eras engine, generator, and `/timeline`

### Task C1: Milestone detection + era building (`eras.mjs` — extend)

**Files:**
- Modify: `src/lib/eras.mjs` (append; keep B1 exports)
- Modify: `tests/eras.test.ts` (append)

**Interfaces:**
- Produces:
  - `detectMilestoneArrivals(photos, opts?): Record<string, string | null>` — robust first-appearance date per milestone (`null` if never sustained). `photos: { taken_at, uploaded_at, ai_meta }[]`. Guard: earliest date `d` such that ≥`minCount` (default 2) occurrences fall in `[d, d+windowDays]` (default 45).
  - `buildEras(photos, opts?): { key, milestones, start, end }[]` — deterministic chapters. Bundles arrivals within `bundleDays` (default 20) into one boundary; leading "before" era from earliest photo to first boundary; last era `end: null`.
  - `defaultEraTitle(era): string` — deterministic fallback title (e.g. "Before the build" / "Raised beds & stock tank").
  - `groupBySeason(photos): { key, season, year, photos }[]` — chronological Season+Year groups.

- [ ] **Step 1: Write the failing test (append to `tests/eras.test.ts`)**

```ts
import { detectMilestoneArrivals, buildEras, groupBySeason, defaultEraTitle } from "../src/lib/eras.mjs";

const mk = (taken_at: string, flags: Record<string, boolean> = {}) => ({
  taken_at, uploaded_at: taken_at,
  ai_meta: { hardscape: { stock_tank: false, raised_beds: false, cedar_planters: false, vines: false, cover_crop_field: false, ...flags } },
});

describe("detectMilestoneArrivals", () => {
  it("returns the first sustained date and ignores a lone early outlier", () => {
    const photos = [
      mk("2024-11-01", { raised_beds: true }),          // lone false positive
      mk("2025-04-13", { raised_beds: true }),
      mk("2025-04-20", { raised_beds: true }),
      mk("2025-05-01", { raised_beds: true }),
    ];
    const arr = detectMilestoneArrivals(photos);
    expect(arr.raised_beds).toBe("2025-04-13");
  });
  it("returns null for a milestone that never sustains", () => {
    const arr = detectMilestoneArrivals([mk("2025-01-01", { vines: true })]);
    expect(arr.vines).toBeNull();
  });
});

describe("buildEras", () => {
  const photos = [
    mk("2024-10-17"),
    mk("2025-04-13", { raised_beds: true }), mk("2025-04-14", { raised_beds: true, stock_tank: true }),
    mk("2025-04-20", { raised_beds: true, stock_tank: true }),
    mk("2025-05-18", { cover_crop_field: true }), mk("2025-05-25", { cover_crop_field: true }),
    mk("2025-06-01", { cover_crop_field: true }),
  ];
  const eras = buildEras(photos);
  it("starts with a pre-build era from the earliest photo", () => {
    expect(eras[0].start).toBe("2024-10-17");
    expect(eras[0].milestones).toEqual([]);
  });
  it("bundles same-window arrivals into one boundary", () => {
    expect(eras[1].milestones.sort()).toEqual(["raised_beds", "stock_tank"]);
  });
  it("ends the last era open", () => {
    expect(eras[eras.length - 1].end).toBeNull();
  });
  it("produces a deterministic fallback title", () => {
    expect(defaultEraTitle(eras[0])).toMatch(/before/i);
    expect(defaultEraTitle(eras[1]).toLowerCase()).toContain("raised beds");
  });
});

describe("groupBySeason", () => {
  it("groups chronologically by season+year", () => {
    const groups = groupBySeason([mk("2025-05-01"), mk("2025-07-01"), mk("2024-11-01")]);
    expect(groups.map((g) => g.key)).toEqual(["fall-2024", "spring-2025", "summer-2025"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/eras.test.ts`
Expected: FAIL — `detectMilestoneArrivals` etc. not exported.

- [ ] **Step 3: Append the implementation to `src/lib/eras.mjs`**

```js
// --- appended below B1 exports ---
const dayMs = 86400000;
const takenOf = (p) => p.taken_at ?? p.uploaded_at;
const flagsOf = (p) => (p.ai_meta && p.ai_meta.hardscape) || {};

/** First date d where >= minCount occurrences fall within [d, d+windowDays]. */
function firstSustained(dates, windowDays, minCount) {
  const sorted = [...dates].sort();
  for (let i = 0; i < sorted.length; i++) {
    const start = new Date(sorted[i]).getTime();
    const count = sorted.filter((d) => {
      const t = new Date(d).getTime();
      return t >= start && t <= start + windowDays * dayMs;
    }).length;
    if (count >= minCount) return sorted[i];
  }
  return null;
}

export function detectMilestoneArrivals(photos, opts = {}) {
  const { windowDays = 45, minCount = 2 } = opts;
  const out = {};
  for (const key of MILESTONE_KEYS) {
    const dates = photos.filter((p) => flagsOf(p)[key] === true).map(takenOf);
    out[key] = firstSustained(dates, windowDays, minCount);
  }
  return out;
}

export function buildEras(photos, opts = {}) {
  const { bundleDays = 20 } = opts;
  const arrivals = detectMilestoneArrivals(photos, opts);
  const points = MILESTONE_KEYS
    .filter((k) => arrivals[k])
    .map((k) => ({ key: k, date: arrivals[k] }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Bundle arrivals within bundleDays into one boundary.
  const boundaries = [];
  for (const p of points) {
    const last = boundaries[boundaries.length - 1];
    if (last && new Date(p.date).getTime() - new Date(last.date).getTime() <= bundleDays * dayMs) {
      last.milestones.push(p.key);
    } else {
      boundaries.push({ date: p.date, milestones: [p.key] });
    }
  }

  const earliest = photos.map(takenOf).sort()[0] ?? new Date().toISOString();
  const eras = [{ key: "era-0", milestones: [], start: earliest, end: boundaries[0]?.date ?? null }];
  boundaries.forEach((b, i) => {
    eras.push({ key: `era-${i + 1}`, milestones: b.milestones, start: b.date, end: boundaries[i + 1]?.date ?? null });
  });
  return eras;
}

export function defaultEraTitle(era) {
  if (!era.milestones || era.milestones.length === 0) return "Before the build";
  const labels = era.milestones.map((k) => MILESTONES.find((m) => m.key === k)?.label ?? k);
  return labels.join(" & ");
}

export function groupBySeason(photos) {
  const map = new Map();
  for (const p of photos) {
    const { season, year } = seasonYear(takenOf(p));
    const key = `${season}-${year}`;
    if (!map.has(key)) map.set(key, { key, season, year, photos: [] });
    map.get(key).photos.push(p);
  }
  return [...map.values()].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : ["winter", "spring", "summer", "fall"].indexOf(a.season) - ["winter", "spring", "summer", "fall"].indexOf(b.season),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/eras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eras.mjs tests/eras.test.ts
git commit -m "feat: milestone detection, era building, season grouping"
```

---

### Task C2: `scripts/generate-eras.mjs` — boundaries + AI headlines → `eras.data.ts`

**Files:**
- Create: `scripts/generate-eras.mjs`
- Modify: `package.json` (add `"gen:eras": "node scripts/generate-eras.mjs"`)

**Interfaces:**
- Consumes: `buildEras`, `defaultEraTitle`, `MILESTONES` (eras.mjs); `@anthropic-ai/sdk`; `@supabase/supabase-js`; env `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
- Produces: rewrites `src/lib/eras.data.ts` `ERAS` array (type declarations preserved). `--dry-run` prints eras + prompts, writes nothing, calls no API.

- [ ] **Step 1: Write the script**

```js
// scripts/generate-eras.mjs
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { buildEras, defaultEraTitle, MILESTONES } from "../src/lib/eras.mjs";

config({ path: ".env.local" });
config();

const MODEL = "claude-sonnet-4-6";
const DRY = process.argv.includes("--dry-run");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

async function loadConfirmed(sb) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("zone_photos")
      .select("storage_path, taken_at, uploaded_at, caption, ai_confidence, ai_meta")
      .eq("review_status", "confirmed").order("taken_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function eraPhotos(photos, era) {
  return photos.filter((p) => {
    const d = p.taken_at ?? p.uploaded_at;
    return d >= era.start && (era.end === null || d < era.end);
  });
}

function digest(photos, era) {
  const inEra = eraPhotos(photos, era);
  const captions = inEra.filter((p) => p.caption).slice(0, 20).map((p) => `- ${p.caption}`);
  const bloom = new Set();
  for (const p of inEra) for (const c of p.ai_meta?.botanical?.bloom_colors ?? []) bloom.add(c);
  const ms = era.milestones.map((k) => MILESTONES.find((m) => m.key === k)?.label ?? k);
  return {
    count: inEra.length,
    range: `${era.start.slice(0, 10)} → ${era.end ? era.end.slice(0, 10) : "present"}`,
    milestones: ms,
    bloomColors: [...bloom].slice(0, 12),
    captionSample: captions.join("\n"),
    cover: inEra.slice().sort((a, b) => (b.ai_confidence ?? 0) - (a.ai_confidence ?? 0))[0]?.storage_path ?? null,
  };
}

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { title: { type: "string" }, blurb: { type: "string" } },
  required: ["title", "blurb"],
};

function promptFor(d) {
  return `You are titling one chapter of a residential yard's photo timeline.
Date range: ${d.range}. Photos: ${d.count}. New this chapter: ${d.milestones.join(", ") || "(the established yard, before major additions)"}.
Bloom colors seen: ${d.bloomColors.join(", ") || "none noted"}.
Sample captions:
${d.captionSample || "(none)"}

Return JSON: a short evocative "title" (2-4 words, no date) and a "blurb" (1-2 sentences, past/present tense, describing what changed or what the yard was like this chapter). Do not invent features not implied by the milestones or captions.`;
}

async function headline(anthropic, d) {
  const msg = await anthropic.messages.create({
    model: MODEL, max_tokens: 300,
    messages: [{ role: "user", content: promptFor(d) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  const block = msg.content.find((b) => b.type === "text");
  return JSON.parse(block ? block.text : "{}");
}

function fileContents(eras) {
  const body = eras.map((e) => "  " + JSON.stringify(e)).join(",\n");
  return `// Generated by scripts/generate-eras.mjs — do not edit by hand.
export type MilestoneKey = "stock_tank" | "raised_beds" | "cedar_planters" | "vines" | "cover_crop_field";

export type EraContent = {
  key: string;
  title: string;
  blurb: string;
  milestones: MilestoneKey[];
  start: string;
  end: string | null;
  coverPath: string | null;
  generatedAt: string;
  model: string;
};

export const ERAS: EraContent[] = [
${body}
];
`;
}

async function main() {
  const sb = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const photos = await loadConfirmed(sb);
  const eras = buildEras(photos);
  const now = new Date().toISOString();

  const anthropic = DRY ? null : new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const out = [];
  for (const era of eras) {
    const d = digest(photos, era);
    if (DRY) { console.log(`\n[${era.key}] ${d.range} (${d.count} photos) ms=${d.milestones.join(",")||"—"}`); console.log(promptFor(d)); continue; }
    let title, blurb;
    try { ({ title, blurb } = await headline(anthropic, d)); }
    catch (err) { console.warn(`headline failed for ${era.key}: ${err.message}; using fallback`); title = defaultEraTitle(era); blurb = ""; }
    out.push({ key: era.key, title, blurb, milestones: era.milestones, start: era.start, end: era.end, coverPath: d.cover, generatedAt: now, model: MODEL });
    console.log(`✓ ${era.key}: ${title}`);
  }

  if (DRY) { console.log(`\n(dry run — ${eras.length} eras; wrote nothing)`); return; }
  await writeFile("src/lib/eras.data.ts", fileContents(out));
  console.log(`Wrote src/lib/eras.data.ts (${out.length} eras).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"import:photos"`:

```json
    "gen:eras": "node scripts/generate-eras.mjs"
```

- [ ] **Step 3: Dry-run to sanity-check boundaries (no writes, no API)**

Run: `node scripts/generate-eras.mjs --dry-run`
Expected: prints ~4–6 eras. Verify the first is the pre-build era starting `2024-10-17`, and a boundary bundles `raised_beds`/`stock_tank`/`cedar_planters` around `2025-04-13`. If boundaries look wrong, adjust `windowDays`/`minCount`/`bundleDays` via opts and re-run.

- [ ] **Step 4: Real run (writes `eras.data.ts`, ~4–6 Claude calls)**

Run: `npm run gen:eras`
Expected: prints `✓ era-N: <title>` per era; writes `src/lib/eras.data.ts`. Inspect the file — titles/blurbs read sensibly; `ERAS` typed array intact.

- [ ] **Step 5: Verify the suite still compiles against the regenerated file**

Run: `npm test`
Expected: PASS (facets/eras tests unaffected; `ERAS` now populated).

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-eras.mjs package.json src/lib/eras.data.ts
git commit -m "feat: generate-eras script (deterministic boundaries + AI headlines)"
```

---

### Task C3: `/timeline` page — sticky era rail

**Files:**
- Create: `src/app/timeline/page.tsx`
- Create: `src/app/timeline/TimelineView.tsx`
- Test: `tests/timeline-view.test.tsx`

**Interfaces:**
- Consumes: `getServerSupabase`, `ERAS` (eras.data), `groupBySeason`/`MILESTONES` (eras.mjs), `publicPhotoUrl`, `PhotoLightbox`.
- `TimelineView` props: `{ eras: (EraContent & { seasons: { key: string; label: string; photos: TimelinePhoto[] }[] })[] }` where `TimelinePhoto = { id; storagePath; caption; takenAt; zoneName; quality; bloomColors; reasoning }`.

- [ ] **Step 1: Write the failing test for `TimelineView`**

```tsx
// tests/timeline-view.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TimelineView from "../src/app/timeline/TimelineView";

const eras = [
  { key: "era-0", title: "Before the Build", blurb: "An established yard.", milestones: [],
    start: "2024-10-17", end: "2025-04-13", coverPath: null, generatedAt: "", model: "",
    seasons: [{ key: "fall-2024", label: "Fall 2024", photos: [
      { id: "p1", storagePath: "z/a.jpg", caption: "pool", takenAt: "2024-10-17T00:00:00Z", zoneName: "Pool & Spa", quality: "good", bloomColors: ["pink"], reasoning: null },
    ] }] },
];

describe("TimelineView", () => {
  it("renders era titles, blurbs, and a rail entry per era", () => {
    render(<TimelineView eras={eras as never} />);
    expect(screen.getAllByText("Before the Build").length).toBeGreaterThan(0);
    expect(screen.getByText("An established yard.")).toBeInTheDocument();
    expect(screen.getByText(/Fall 2024/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no eras", () => {
    render(<TimelineView eras={[]} />);
    expect(screen.getByText(/timeline hasn.t been generated/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/timeline-view.test.tsx`
Expected: FAIL — cannot resolve `TimelineView`.

- [ ] **Step 3: Implement `TimelineView` (client, sticky rail)**

```tsx
// src/app/timeline/TimelineView.tsx
"use client";
import { useState } from "react";
import Image from "next/image";
import type { EraContent } from "@/lib/eras.data";
import { MILESTONES } from "@/lib/eras.mjs";
import { publicPhotoUrl } from "@/lib/photos";
import PhotoLightbox from "@/components/PhotoLightbox";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

type TimelinePhoto = {
  id: string; storagePath: string; caption: string | null; takenAt: string | null;
  zoneName: string | null; quality: "good" | "ok" | "poor" | null; bloomColors: string[]; reasoning: string | null;
};
type Season = { key: string; label: string; photos: TimelinePhoto[] };
export type TimelineEra = EraContent & { seasons: Season[] };

export default function TimelineView({ eras }: { eras: TimelineEra[] }) {
  const [open, setOpen] = useState<{ era: TimelineEra; p: TimelinePhoto } | null>(null);

  if (eras.length === 0) {
    return <p style={{ padding: 24, color: "#8a8268" }}>The timeline hasn’t been generated yet. Run <code>npm run gen:eras</code>.</p>;
  }

  return (
    <div style={{ display: "flex", gap: 12, padding: 12, paddingBottom: 72 }}>
      <nav style={{ position: "sticky", top: 12, alignSelf: "flex-start", flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 4, maxWidth: 130 }}>
        {eras.map((e) => (
          <a key={e.key} href={`#${e.key}`} style={{ fontSize: 12, color: "#5a5340", textDecoration: "none", padding: "5px 8px", borderRadius: 6, background: "#efe7d3", border: "1px solid #cbb994" }}>
            {e.title}
          </a>
        ))}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        {eras.map((e) => (
          <section key={e.key} id={e.key} style={{ marginBottom: 28, scrollMarginTop: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: ".08em", color: "#8a8268" }}>
              {e.start.slice(0, 10)} → {e.end ? e.end.slice(0, 10) : "present"}
            </div>
            <h2 style={{ margin: "2px 0 4px", color: "#3f4a2e" }}>{e.title}</h2>
            {e.milestones.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {e.milestones.map((k) => {
                  const m = MILESTONES.find((x) => x.key === k);
                  return <span key={k} style={{ fontSize: 11, background: "#e3dac3", border: "1px solid #cbb994", borderRadius: 999, padding: "1px 8px", marginRight: 4 }}>{m?.icon} {m?.label}</span>;
                })}
              </div>
            )}
            {e.blurb && <p style={{ color: "#5a5340", fontStyle: "italic", margin: "0 0 10px" }}>{e.blurb}</p>}

            {e.seasons.map((s) => (
              <div key={s.key} style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#8e3b5e", margin: "0 0 4px", fontWeight: 600 }}>{s.label} · {s.photos.length}</p>
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                  {s.photos.map((p) => (
                    <button key={p.id} onClick={() => setOpen({ era: e, p })} style={{ flex: "0 0 auto", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                      <Image src={publicPhotoUrl(SUPABASE_URL, p.storagePath)} alt={p.caption ?? "yard photo"} width={120} height={90} loading="lazy"
                        style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #cbb994", display: "block" }} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      {open && (
        <PhotoLightbox
          src={publicPhotoUrl(SUPABASE_URL, open.p.storagePath)}
          alt={open.p.caption ?? "yard photo"}
          onClose={() => setOpen(null)}
          meta={{ caption: open.p.caption, takenAt: open.p.takenAt, zoneName: open.p.zoneName, eraTitle: open.era.title, quality: open.p.quality, bloomColors: open.p.bloomColors, reasoning: open.p.reasoning }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/timeline-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Create the server page (bucket photos into eras → seasons)**

Read the Next.js server-component docs first (Global Constraints). Then:

```tsx
// src/app/timeline/page.tsx
import { getServerSupabase } from "@/lib/supabase/server";
import { ERAS } from "@/lib/eras.data";
import { assignEra, groupBySeason, seasonYear } from "@/lib/eras.mjs";
import type { Zone, ZonePhoto } from "@/lib/types";
import TimelineView, { type TimelineEra } from "./TimelineView";

export const dynamic = "force-dynamic";

const CAP_PER_SEASON = 24; // keep the page light; deep browsing lives in /gallery

export default async function TimelinePage() {
  const sb = getServerSupabase();
  const [{ data: zones }, photos] = await Promise.all([
    sb.from("zones").select("*"),
    (async () => {
      const out: ZonePhoto[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("zone_photos").select("*")
          .eq("review_status", "confirmed").order("taken_at", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as ZonePhoto[]));
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
  ]);

  const zoneName = (id: string | null) => (zones as Zone[] | null)?.find((z) => z.id === id)?.name ?? null;
  const seasonLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace("-", " ");

  const eras: TimelineEra[] = ERAS.map((era) => {
    const inEra = photos.filter((p) => assignEra(p.taken_at ?? p.uploaded_at, ERAS) === era.key);
    const seasons = groupBySeason(inEra).map((g: { key: string; photos: ZonePhoto[] }) => ({
      key: g.key, label: seasonLabel(g.key),
      photos: g.photos.slice(0, CAP_PER_SEASON).map((p) => ({
        id: p.id, storagePath: p.storage_path, caption: p.caption, takenAt: p.taken_at,
        zoneName: zoneName(p.zone_id), quality: p.ai_meta?.quality ?? null,
        bloomColors: p.ai_meta?.botanical?.bloom_colors ?? [], reasoning: p.ai_meta?.reasoning ?? null,
      })),
    }));
    return { ...era, seasons };
  });

  return <TimelineView eras={eras} />;
}
```

- [ ] **Step 6: Typecheck + preview**

Run: `npx tsc --noEmit` (no errors). Preview `/timeline`: rail lists eras; clicking jumps; each era shows title/blurb/milestones + season strips; a photo opens the enriched lightbox.

- [ ] **Step 7: Commit**

```bash
git add src/app/timeline/page.tsx src/app/timeline/TimelineView.tsx tests/timeline-view.test.tsx
git commit -m "feat: /timeline page — sticky era rail with nested seasons"
```

---

### Task C4: Nav "Timeline" link

**Files:**
- Modify: `src/components/Nav.tsx`
- Modify: `tests/nav.test.tsx`

- [ ] **Step 1: Add the failing test (append to `tests/nav.test.tsx`)**

```tsx
it("renders a public Timeline link", () => {
  render(<EditModeProvider><Nav /></EditModeProvider>);
  expect(screen.getByRole("link", { name: /timeline/i })).toBeDefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/nav.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the link (after Gallery)**

```tsx
      <Link href="/timeline" style={item}>Timeline</Link>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Nav.tsx tests/nav.test.tsx
git commit -m "feat: public Timeline nav link"
```

---

## Final verification

- [ ] **Full suite:** `npm test` → all green.
- [ ] **Typecheck:** `npx tsc --noEmit` → no errors.
- [ ] **Lint:** `npm run lint` → clean (fix any new warnings).
- [ ] **Preview walk-through:** map zone photo → enrichment; `/gallery` filter + search + lightbox; `/timeline` rail + seasons + lightbox.
- [ ] Confirm the four nav links (Map / Tracker / Gallery / Timeline) render; Photos stays edit-only.

## Notes for the implementer

- **Nav is getting crowded** (Map/Tracker/Gallery/Timeline + edit-only Photos = 5 items on a phone bottom bar). If it looks cramped in preview, that's a real concern — flag it, but don't restructure the nav as part of this plan.
- **`eras.mjs` in tests:** vitest imports `.mjs` fine (see `tests/zone-classifier.test.ts`). Import with the explicit `.mjs` extension.
- **`deriveFacet` runs ~1,900×** on the server per gallery load — it's pure and cheap, but if the projection payload feels heavy in preview, the fallback is to drop `reasoning` from `PhotoFacet` and fetch it on lightbox-open (noted as a spec open item).
- **Season/year uses calendar year** — Dec 2024 is "winter 2024", Jan 2025 is "winter 2025" (two groups). Acceptable; revisit only if it reads oddly on the timeline.
