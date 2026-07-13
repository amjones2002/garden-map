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
