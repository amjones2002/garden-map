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
