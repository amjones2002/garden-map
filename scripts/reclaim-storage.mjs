/**
 * Reclaim Supabase storage in the zone-photos bucket.
 *
 * Three categories of waste, all safe to act on:
 *
 *   1. ORPHANS — objects no zone_photos row points at. The Upload tab uploads
 *      to storage *before* a zone is chosen, and Skip/remove only dropped the
 *      item from React state, so every skipped or errored upload leaked a file.
 *      Nothing in the app can reach these.
 *   2. REJECTED — objects behind review_status='rejected' rows. RLS hides those
 *      rows from the public site permanently and no read path selects them, so
 *      the bytes are dead weight. The *row* is kept: `source_ref` has a unique
 *      index that stops `import:photos` re-importing the same photo.
 *   3. OVERSIZED — source='manual' objects above --max-bytes. These are raw
 *      phone originals that were never downscaled; shrinking them to the display
 *      spec is the resize that should have happened at upload time. Rewritten to
 *      a new .webp path, with the row repointed and the old object dropped.
 *
 * batch_import objects are already display copies and are never touched.
 *
 * Dry run by default. Pass --apply to actually write.
 *
 *   node scripts/reclaim-storage.mjs                     # audit only
 *   node scripts/reclaim-storage.mjs --apply             # orphans + rejected
 *   node scripts/reclaim-storage.mjs --apply --shrink    # + oversized originals
 */
import { config } from "dotenv";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  ZONE_PHOTOS_BUCKET,
  DISPLAY_MAX_EDGE,
  DISPLAY_QUALITY_PCT,
  DISPLAY_MIME,
  DISPLAY_EXT,
} from "../src/lib/image-spec.mjs";

config({ path: ".env.local" });
config();

const DB_PAGE = 1000; // supabase-js caps a single select at 1000 rows
const LIST_PAGE = 100; // storage list() caps at 100 entries
const REMOVE_BATCH = 100;

function parseFlags(argv) {
  const flags = { apply: false, shrink: false, maxBytes: 1024 * 1024 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--shrink") flags.shrink = true;
    else if (a === "--max-bytes") flags.maxBytes = Number(argv[++i]);
  }
  return flags;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return v;
}

const fmt = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
};

/** Every object in the bucket, as { name, size }. Walks one level of prefixes. */
async function listAllObjects(supabase) {
  const out = [];

  async function listPrefix(prefix) {
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await supabase.storage
        .from(ZONE_PHOTOS_BUCKET)
        .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      if (!data || data.length === 0) return;
      for (const entry of data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Storage fakes directories: a listing row with no id is a prefix.
        if (entry.id == null) await listPrefix(path);
        else out.push({ name: path, size: Number(entry.metadata?.size ?? 0) });
      }
      if (data.length < LIST_PAGE) return;
    }
  }

  await listPrefix("");
  return out;
}

/** Every zone_photos row, paginated. */
async function listAllRows(supabase) {
  const out = [];
  for (let from = 0; ; from += DB_PAGE) {
    const { data, error } = await supabase
      .from("zone_photos")
      .select("id, storage_path, review_status, source")
      .order("id")
      .range(from, from + DB_PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < DB_PAGE) break;
  }
  return out;
}

async function removeObjects(supabase, paths, apply) {
  if (!apply || paths.length === 0) return;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const slice = paths.slice(i, i + REMOVE_BATCH);
    const { error } = await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove(slice);
    if (error) console.error(`  ! remove failed (${slice.length} objects): ${error.message}`);
  }
}

/**
 * Rewrite one oversized original as a display-spec WebP at a fresh path, repoint
 * the row, then drop the old object. Ordered so a failure never leaves the row
 * pointing at something that does not exist.
 */
async function shrinkOne(supabase, row, object, apply) {
  const { data: blob, error: dlErr } = await supabase.storage
    .from(ZONE_PHOTOS_BUCKET)
    .download(row.storage_path);
  if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message ?? "no body"}`);

  const input = Buffer.from(await blob.arrayBuffer());
  const output = await sharp(input)
    .rotate()
    .resize({
      width: DISPLAY_MAX_EDGE,
      height: DISPLAY_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: DISPLAY_QUALITY_PCT })
    .toBuffer();

  if (output.length >= object.size) {
    return { saved: 0, skipped: true };
  }
  if (!apply) return { saved: object.size - output.length, skipped: false };

  const folder = row.storage_path.includes("/") ? row.storage_path.split("/")[0] : "_inbox";
  const newPath = `${folder}/${crypto.randomUUID()}.${DISPLAY_EXT}`;

  const up = await supabase.storage
    .from(ZONE_PHOTOS_BUCKET)
    .upload(newPath, output, { contentType: DISPLAY_MIME, upsert: false });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);

  const { error: updErr } = await supabase
    .from("zone_photos")
    .update({ storage_path: newPath })
    .eq("id", row.id);
  if (updErr) {
    // Roll back the new object so we don't create an orphan of our own.
    await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([newPath]);
    throw new Error(`row update failed: ${updErr.message}`);
  }

  await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([row.storage_path]);
  return { saved: object.size - output.length, skipped: false };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  console.log(flags.apply ? "Mode: APPLY (writes)" : "Mode: dry run (no writes)");

  const [objects, rows] = await Promise.all([listAllObjects(supabase), listAllRows(supabase)]);
  const rowByPath = new Map(rows.map((r) => [r.storage_path, r]));
  const total = objects.reduce((n, o) => n + o.size, 0);
  console.log(`Bucket: ${objects.length} objects, ${fmt(total)} · rows: ${rows.length}\n`);

  const orphans = [];
  const rejected = [];
  const oversized = [];

  for (const object of objects) {
    const row = rowByPath.get(object.name);
    if (!row) {
      orphans.push(object);
    } else if (row.review_status === "rejected") {
      rejected.push(object);
    } else if (row.source === "manual" && object.size > flags.maxBytes) {
      oversized.push({ row, object });
    }
  }

  const sum = (list, pick = (x) => x.size) => list.reduce((n, x) => n + pick(x), 0);
  console.log(`orphans:   ${orphans.length} objects, ${fmt(sum(orphans))}`);
  console.log(`rejected:  ${rejected.length} objects, ${fmt(sum(rejected))}`);
  console.log(
    `oversized: ${oversized.length} objects, ${fmt(sum(oversized, (x) => x.object.size))}` +
      (flags.shrink ? "" : "  (skipped — pass --shrink)"),
  );

  await removeObjects(supabase, orphans.map((o) => o.name), flags.apply);
  await removeObjects(supabase, rejected.map((o) => o.name), flags.apply);

  let reclaimed = sum(orphans) + sum(rejected);

  if (flags.shrink && oversized.length) {
    console.log("");
    let done = 0;
    let failed = 0;
    for (const item of oversized) {
      try {
        const { saved, skipped } = await shrinkOne(supabase, item.row, item.object, flags.apply);
        reclaimed += saved;
        done++;
        if (done % 10 === 0 || done === oversized.length) {
          console.log(`  shrunk ${done}/${oversized.length} (${fmt(reclaimed)} reclaimed so far)`);
        }
        if (skipped) console.log(`  = ${item.row.storage_path}: already small enough, left as-is`);
      } catch (e) {
        failed++;
        console.error(`  ! ${item.row.storage_path}: ${e.message}`);
      }
    }
    if (failed) console.log(`  ${failed} failed`);
  }

  console.log(
    `\n${flags.apply ? "Reclaimed" : "Would reclaim"} ${fmt(reclaimed)} — ` +
      `bucket ${fmt(total)} → ${fmt(total - reclaimed)}`,
  );
  if (!flags.apply) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
