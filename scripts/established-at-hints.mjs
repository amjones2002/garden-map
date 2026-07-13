// Data-entry aid for zones.established_at. For each active bed, prints the
// earliest confirmed photo (an upper bound on when the bed was built) plus a
// compact monthly count of confirmed photos, so a chosen established_at makes it
// obvious how many confirmed photos it would flag. Read-only.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .env.local`); process.exit(1); }
  return v;
}

const ym = (iso) => (iso ?? "").slice(0, 7); // YYYY-MM

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { data: zones, error: zErr } = await supabase
    .from("zones")
    .select("id, slug, name, area, established_at")
    .is("archived_at", null)
    .order("area")
    .order("sort_order");
  if (zErr) throw zErr;

  for (const z of zones) {
    const { data: photos, error: pErr } = await supabase
      .from("zone_photos")
      .select("taken_at")
      .eq("zone_id", z.id)
      .eq("review_status", "confirmed");
    if (pErr) throw pErr;

    const dates = photos.map((p) => p.taken_at).filter(Boolean).sort();
    const earliest = dates[0] ? dates[0].slice(0, 10) : "—";
    const counts = new Map();
    for (const d of dates) counts.set(ym(d), (counts.get(ym(d)) ?? 0) + 1);
    const histo = [...counts.entries()].sort().map(([m, c]) => `${m}:${c}`).join("  ");

    console.log(
      `\n${z.area.padEnd(6)} ${z.slug.padEnd(20)} ${z.name}` +
      `\n  established_at: ${z.established_at ?? "(null)"}   earliest confirmed: ${earliest}   confirmed: ${dates.length}` +
      (histo ? `\n  by month: ${histo}` : ""),
    );
  }
  console.log("\nBeds whose earliest confirmed photo is ~2024-10 predate the record — leave established_at null.");
}

main().catch((e) => { console.error(e); process.exit(1); });
