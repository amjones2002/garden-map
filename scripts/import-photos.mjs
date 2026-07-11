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
const ZONE_PHOTOS_BUCKET = "zone-photos"; // mirrors src/lib/photos.ts

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

  // Skip already-imported source_refs (idempotent re-runs). PostgREST caps a
  // response at 1000 rows, so page through every ref — otherwise a large prior
  // import looks "undone" and gets re-submitted (and re-billed).
  const done = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("zone_photos").select("source_ref")
      .not("source_ref", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data) done.add(r.source_ref);
    if (data.length < 1000) break;
  }

  await mkdir(DISPLAY_DIR, { recursive: true });
  const files = (await walkImages(flags.dir)).slice(0, flags.limit);
  const manifest = {};
  const batchIds = [];
  let chunk = [], chunkBytes = 0, total = 0, skipped = 0;

  // Persist the manifest (all entries so far + submitted batch ids) so a crash
  // can never orphan already-submitted batches.
  const persist = () => writeFile(MANIFEST, JSON.stringify({ batchIds, manifest }, null, 2));

  // Submit each batch as its chunk fills, so peak memory is one chunk of
  // base64 images — accumulating all 3k+ would exhaust the heap.
  async function flushChunk() {
    if (!chunk.length) return;
    const batch = await anthropic.messages.batches.create({ requests: chunk });
    batchIds.push(batch.id);
    await persist();
    console.log(`Submitted batch ${batch.id} (${chunk.length} requests).`);
    chunk = [];
    chunkBytes = 0;
  }

  for (const file of files) {
    const sourceRef = sourceRefFor(flags.dir, file);
    if (done.has(sourceRef)) { console.log(`skip (already imported): ${sourceRef}`); continue; }

    try {
      const buffer = await readFile(file);
      const { date, source } = await extractCaptureDate(file, buffer);
      const displayBuf = await downscale(buffer, { maxEdge: STORE_MAX_EDGE, quality: STORE_QUALITY });
      const apiBuf = await downscale(buffer, { maxEdge: API_MAX_EDGE, quality: API_QUALITY });

      const key = crypto.createHash("sha1").update(sourceRef).digest("hex");
      const displayPath = join(DISPLAY_DIR, `${key}.jpg`);
      await writeFile(displayPath, displayBuf);

      const customId = key.slice(0, 64);
      manifest[customId] = { sourceRef, captureDate: date.toISOString(), captureSource: source, displayPath };

      const req = buildBatchRequest({ customId, systemPrompt, schema, base64Image: apiBuf.toString("base64"), mediaType: "image/jpeg" });
      const bytes = Buffer.byteLength(JSON.stringify(req));
      if (chunk.length && (chunkBytes + bytes > MAX_BATCH_BYTES || chunk.length >= MAX_BATCH_REQUESTS)) {
        await flushChunk();
      }
      chunk.push(req);
      chunkBytes += bytes;
      total++;
      if (total % 100 === 0) console.log(`prepared ${total} photos...`);
    } catch (e) {
      skipped++;
      console.warn(`SKIP (unreadable image): ${sourceRef} — ${e.message}`);
    }
  }

  await flushChunk();
  await persist();
  if (total === 0) { console.log("Nothing new to submit."); return; }

  console.log(`Submitted ${total} requests across ${batchIds.length} batch(es). Skipped ${skipped} unreadable image(s).`);
  console.log(`Run: npm run import:photos -- collect${flags.dryRun ? " --dry-run" : ""}`);
}

// ---- REBUILD (recovery) ---------------------------------------------------
// Reconstruct the manifest deterministically (custom_id = sha1(sourceRef)) and
// point it at every batch in the account, so a crashed submit's already-paid
// results can still be collected. Reads no images beyond EXIF; downscales none.
async function rebuild(flags) {
  if (!flags.dir) { console.error("rebuild requires --dir <folder>"); process.exit(1); }
  const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

  const batchIds = [];
  for await (const b of anthropic.messages.batches.list({ limit: 100 })) batchIds.push(b.id);

  const files = await walkImages(flags.dir);
  const manifest = {};
  let n = 0, skipped = 0;
  for (const file of files) {
    const sourceRef = sourceRefFor(flags.dir, file);
    try {
      const buffer = await readFile(file);
      const { date, source } = await extractCaptureDate(file, buffer);
      const key = crypto.createHash("sha1").update(sourceRef).digest("hex");
      manifest[key.slice(0, 64)] = { sourceRef, captureDate: date.toISOString(), captureSource: source, displayPath: join(DISPLAY_DIR, `${key}.jpg`) };
      if (++n % 500 === 0) console.log(`rebuilt ${n}...`);
    } catch (e) {
      skipped++;
      console.warn(`SKIP (unreadable image): ${sourceRef} — ${e.message}`);
    }
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify({ batchIds, manifest }, null, 2));
  console.log(`Rebuilt manifest: ${n} entries, ${skipped} skipped, over ${batchIds.length} batch(es).`);
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
    try {
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
    if (counts.inserted % 200 === 0) console.log(`imported ${counts.inserted}...`);
    } catch (e) {
      counts.errored++;
      console.warn(`result error: ${result.custom_id} — ${e.message}`);
    }
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
else if (cmd === "rebuild") rebuild(flags).catch((e) => { console.error(e); process.exit(1); });
else { console.error("Usage: npm run import:photos -- <submit|collect|rebuild> [--dir <folder>] [--limit N] [--threshold 0.7] [--dry-run]"); process.exit(1); }
