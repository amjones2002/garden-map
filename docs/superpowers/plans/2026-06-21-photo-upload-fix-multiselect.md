# Photo Upload Fix + Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 413 errors on photo upload by routing files directly from the browser to Supabase Storage via signed upload URLs, and add multi-file selection.

**Architecture:** Two new lightweight API routes replace the old multipart POST — one issues a signed Supabase upload URL, one records metadata after the client uploads directly. `ZonePanel.tsx` drives parallel uploads and shows a live counter.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase JS client (`@supabase/supabase-js`) · Vitest + jsdom

## Global Constraints

- All API routes use `requireEdit()` from `@/lib/require-edit` for the edit gate — never skip it
- Server-side Supabase access uses `getServerSupabase()` from `@/lib/supabase/server` (service-role, `server-only`)
- Browser Supabase access uses `getBrowserSupabase()` from `@/lib/supabase/client` (anon)
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the only env vars needed — already set on Vercel
- No new dependencies; no schema changes
- Every task ends with `npm test && npm run build` both passing before committing
- Before writing any Next.js API route code, skim `node_modules/next/dist/docs/` for App Router route handler conventions — APIs may differ from training data

---

## File Map

| File | Action | What it does |
|------|--------|--------------|
| `src/app/api/zone-photos/upload-url/route.ts` | **Create** | Issues signed Supabase upload URL; gated GET |
| `src/app/api/zone-photos/confirm/route.ts` | **Create** | Inserts `zone_photos` row after client upload; gated POST |
| `src/app/api/zone-photos/route.ts` | **Modify** | Remove `POST` export; keep `DELETE` unchanged |
| `src/components/ZonePanel.tsx` | **Modify** | Replace single-file upload with parallel multi-upload; update state + UI |

---

### Task 1: `GET /api/zone-photos/upload-url` — signed URL route

**Files:**
- Create: `src/app/api/zone-photos/upload-url/route.ts`

**Interfaces:**
- Consumes: `requireEdit()`, `getServerSupabase()`, `ZONE_PHOTOS_BUCKET`
- Produces: `GET /api/zone-photos/upload-url?zone_id=&filename=&type=` → `{ signedUrl: string, path: string }` on 200, `{ error: string }` on 400/401

- [ ] **Step 1: Create the route file**

```typescript
// src/app/api/zone-photos/upload-url/route.ts
import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";

export async function GET(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const zone_id = searchParams.get("zone_id");
  const filename = searchParams.get("filename");
  const type = searchParams.get("type") ?? "image/jpeg";

  if (!zone_id || !filename) {
    return NextResponse.json({ error: "zone_id and filename required" }, { status: 400 });
  }

  const ext = (filename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${zone_id}/${crypto.randomUUID()}.${ext}`;

  const supabase = getServerSupabase();
  const { data, error } = await supabase.storage
    .from(ZONE_PHOTOS_BUCKET)
    .createSignedUploadUrl(path);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ signedUrl: data.signedUrl, path });
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: no TypeScript or Next.js errors. If `createSignedUploadUrl` is flagged as unknown, check the installed `@supabase/supabase-js` version — look at `node_modules/@supabase/supabase-js/dist/main/lib/StorageFileApi.d.ts` for the exact method name.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zone-photos/upload-url/route.ts
git commit -m "feat: add signed upload URL route for zone photos"
```

---

### Task 2: `POST /api/zone-photos/confirm` — metadata insert route

**Files:**
- Create: `src/app/api/zone-photos/confirm/route.ts`

**Interfaces:**
- Consumes: `requireEdit()`, `getServerSupabase()`
- Produces: `POST /api/zone-photos/confirm` body `{ zone_id, storage_path, taken_at?, caption? }` → `ZonePhoto` row on 201, `{ error: string }` on 400/401

- [ ] **Step 1: Create the route file**

```typescript
// src/app/api/zone-photos/confirm/route.ts
import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: { zone_id?: string; storage_path?: string; taken_at?: string; caption?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const { zone_id, storage_path, taken_at, caption } = body;
  if (!zone_id || !storage_path) {
    return NextResponse.json({ error: "zone_id and storage_path required" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("zone_photos")
    .insert({
      zone_id,
      storage_path,
      caption: caption?.trim() || null,
      taken_at: taken_at ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zone-photos/confirm/route.ts
git commit -m "feat: add zone-photos confirm route for metadata insert"
```

---

### Task 3: Remove old `POST` from `zone-photos/route.ts`

**Files:**
- Modify: `src/app/api/zone-photos/route.ts`

**Interfaces:**
- The file currently exports `POST` (multipart upload) and `DELETE`. After this task it exports only `DELETE`.

- [ ] **Step 1: Open the file and delete the `POST` export**

The entire block from line 7 (`export async function POST`) through line 51 (`}`) is removed. The `DELETE` export (line 54 onward) is kept verbatim. Also remove the now-unused `ZONE_PHOTOS_BUCKET` import if it was only used by `POST` — check whether `DELETE` uses it; it does not (DELETE queries by id, not path). Remove that import.

The resulting file:

```typescript
// src/app/api/zone-photos/route.ts
import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

/** Delete a zone photo by id (?id=). Gated. */
export async function DELETE(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data: row } = await supabase.from("zone_photos").select("storage_path").eq("id", id).single();
  if (row?.storage_path) {
    await supabase.storage.from("zone-photos").remove([row.storage_path]);
  }
  const { error } = await supabase.from("zone_photos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run tests and build**

```bash
npm test && npm run build
```

Expected: all existing tests pass, clean build.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zone-photos/route.ts
git commit -m "refactor: remove multipart POST from zone-photos route (replaced by upload-url + confirm)"
```

---

### Task 4: Update `ZonePanel.tsx` — multi-upload client

**Files:**
- Modify: `src/components/ZonePanel.tsx`

**Interfaces:**
- Consumes: `GET /api/zone-photos/upload-url` → `{ signedUrl, path }`
- Consumes: `POST /api/zone-photos/confirm` → `ZonePhoto`
- Removes: `uploading: boolean` state
- Adds: `uploadProgress: { total: number; done: number } | null` state, `uploadError: string | null` state

- [ ] **Step 1: Replace upload state and function**

At the top of the component, replace:
```typescript
const [uploading, setUploading] = useState(false);
```
with:
```typescript
const [uploadProgress, setUploadProgress] = useState<{ total: number; done: number } | null>(null);
const [uploadError, setUploadError] = useState<string | null>(null);
```

Replace the `uploadPhoto(file: File)` function entirely with `uploadPhotos(files: File[])`:

```typescript
async function uploadPhotos(files: File[]) {
  setUploadError(null);
  setUploadProgress({ total: files.length, done: 0 });
  let successCount = 0;

  await Promise.all(
    files.map(async (file) => {
      try {
        const urlRes = await fetch(
          `/api/zone-photos/upload-url?zone_id=${encodeURIComponent(zone.id)}&filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "image/jpeg")}`,
        );
        if (!urlRes.ok) throw new Error(await urlRes.text());
        const { signedUrl, path } = (await urlRes.json()) as { signedUrl: string; path: string };

        const putRes = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "image/jpeg" },
        });
        if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`);

        const confirmRes = await fetch("/api/zone-photos/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zone_id: zone.id,
            storage_path: path,
            taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          }),
        });
        if (!confirmRes.ok) throw new Error(await confirmRes.text());

        const newPhoto = (await confirmRes.json()) as ZonePhoto;
        setPhotos((prev) => sortChronological([...prev, newPhoto]));
        successCount++;
      } catch (err) {
        console.error("Photo upload failed:", err);
      } finally {
        setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
      }
    }),
  );

  setUploadProgress(null);
  if (successCount === 0) setUploadError("Upload failed — please try again.");
}
```

- [ ] **Step 2: Update the file input and button label**

Replace the `<label>` block (the `{unlocked && (...)}` section containing the file input) with:

```tsx
{unlocked && (
  <div style={{ marginTop: 6 }}>
    <label
      style={{
        display: "inline-block",
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #cbb994",
        background: "#e3dac3",
        cursor: uploadProgress ? "default" : "pointer",
        fontSize: 13,
        opacity: uploadProgress ? 0.7 : 1,
      }}
    >
      {uploadProgress
        ? `Uploading ${uploadProgress.done} of ${uploadProgress.total}…`
        : "+ Add photos"}
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={!!uploadProgress}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) uploadPhotos(files);
          e.target.value = "";
        }}
      />
    </label>
    {uploadError && (
      <p style={{ color: "#8e3b5e", fontSize: 12, margin: "4px 0 0" }}>{uploadError}</p>
    )}
  </div>
)}
```

- [ ] **Step 3: Run tests and build**

```bash
npm test && npm run build
```

Expected: all tests pass, clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/ZonePanel.tsx
git commit -m "feat: multi-select photo upload via signed URLs (fixes 413)"
```

---

### Task 5: Live verification

- [ ] **Step 1: Open the deployed preview or run locally**

If running locally: `npm run dev`, navigate to the map, click a zone.

If testing against production: push the branch to Vercel preview.

- [ ] **Step 2: Unlock edit mode and upload a single large photo (>4.5 MB)**

Expected: spinner shows "Uploading 0 of 1…" → "Uploading 1 of 1…" → disappears. Photo appears in the gallery immediately without a full reload.

- [ ] **Step 3: Upload multiple photos at once**

Use the file picker to select 3+ photos simultaneously.

Expected: counter shows correct total, photos appear as each one finishes (in whatever order network delivers them), no 413 error in the browser network tab.

- [ ] **Step 4: Verify error case**

Temporarily break the signed URL route (e.g. pass a bad zone_id) and try uploading.

Expected: "Upload failed — please try again." appears below the button. Restore the route.

- [ ] **Step 5: Run final checks**

```bash
npm test && npm run build
```

Expected: all tests pass, clean build.
