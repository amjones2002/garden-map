import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fitAffine, polygonCentroid, filterPlotOutliers } from "../src/lib/georeference.mjs";

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

  const rawPoints = [];
  for (const p of photos ?? []) {
    const c = centroidById.get(p.zone_id);
    if (!c) continue;
    rawPoints.push({ lat: Number(p.gps_lat), lng: Number(p.gps_lng), x: c.x, y: c.y, zoneId: p.zone_id });
  }

  // Drop off-site photos / bad GPS fixes before fitting — a single km-scale
  // outlier would otherwise dominate the least-squares affine fit.
  const points = filterPlotOutliers(rawPoints);
  const dropped = rawPoints.length - points.length;
  if (dropped > 0) console.log(`Dropped ${dropped} off-plot outlier(s) (>100m from median center).`);

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
