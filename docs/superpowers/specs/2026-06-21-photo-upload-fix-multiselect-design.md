# Photo Upload Fix + Multi-Select Design

_Date: 2026-06-21_

## Problem

Uploading a photo via `POST /api/zone-photos` returns **413 Content Too Large** on Vercel. Vercel serverless functions cap request bodies at ~4.5 MB; typical phone photos exceed this. The upload spinner disappears and no photo appears — the failure is silent because the client never checks `response.ok`.

## Solution

Route file bytes directly from the browser to Supabase Storage using a **signed upload URL**, bypassing Vercel entirely. The API routes handle only lightweight JSON (auth gate + metadata). Also add multi-file select so users can upload multiple photos in one picker interaction.

## Architecture

### New API routes

**`GET /api/zone-photos/upload-url`**
- Query params: `zone_id`, `filename`, `type` (MIME)
- Gated by `requireEdit()`
- Server calls `supabase.storage.from(ZONE_PHOTOS_BUCKET).createSignedUploadUrl(path)` using the service-role client
- `path` format: `${zone_id}/${crypto.randomUUID()}.${ext}` (same as before)
- Returns `{ signedUrl: string, path: string }`
- Returns 400 if params missing, 401 if not edit-unlocked

**`POST /api/zone-photos/confirm`**
- Body: `{ zone_id: string, storage_path: string, taken_at?: string, caption?: string }`
- Gated by `requireEdit()`
- Inserts one `zone_photos` row; returns the new row (201)
- Returns 400 on validation failure or DB error

### Removed

`POST /api/zone-photos` (the multipart file upload route) is removed. `DELETE /api/zone-photos` is unchanged.

## Client flow (`ZonePanel.tsx`)

### Upload state

```ts
type UploadProgress = { total: number; done: number } | null;
const [uploadProgress, setUploadProgress] = useState<UploadProgress>(null);
```

Replaces the boolean `uploading` state.

### `uploadPhotos(files: File[])`

For each file, in parallel:
1. `GET /api/zone-photos/upload-url?zone_id=…&filename=…&type=…` → `{ signedUrl, path }`
2. `PUT signedUrl` with the raw file as the body and `Content-Type` header
3. `POST /api/zone-photos/confirm` with `{ zone_id, storage_path: path, taken_at }`
4. On success: increment `done` counter and append the returned row to local `photos` state (no full re-fetch needed)
5. On failure: log to console; decrement `total` so the counter stays accurate

After all settle: clear `uploadProgress`. If all failed, set a brief `uploadError` string shown under the button (cleared on next attempt).

### File input changes

```tsx
<input
  type="file"
  accept="image/*"
  multiple                          // ← new
  onChange={(e) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) uploadPhotos(files);
    e.target.value = "";
  }}
/>
```

Button label:
- Idle: `"+ Add photos"`
- Active: `"Uploading 2 of 5…"` (reflects live `done`/`total`)

## Error handling

- Per-file failures are non-fatal and logged to console.
- If every file in a batch fails, an inline error message appears under the button: `"Upload failed — please try again."`
- No automatic retries.
- `taken_at` continues to use `file.lastModified` (EXIF extraction is backlog item #2).

## What does NOT change

- `zone_photos` database schema — no migration needed
- `DELETE /api/zone-photos` route
- `src/lib/photos.ts` (`publicPhotoUrl`, `sortChronological`)
- Photo display in `ZonePanel.tsx` (gallery, captions, delete button)
- Edit gate (`requireEdit()`, cookie mechanism)

## Files touched

| File | Change |
|------|--------|
| `src/app/api/zone-photos/route.ts` | Remove `POST` handler |
| `src/app/api/zone-photos/upload-url/route.ts` | New — signed URL generator |
| `src/app/api/zone-photos/confirm/route.ts` | New — metadata insert |
| `src/components/ZonePanel.tsx` | Replace `uploadPhoto` + upload state; add `multiple` to input |
| `tests/photos.test.ts` | Add tests for new routes if applicable |
