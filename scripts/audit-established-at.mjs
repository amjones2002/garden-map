// Run AFTER zones.established_at dates are entered. Lists every CONFIRMED photo
// whose taken_at predates its bed's established_at — i.e. tagged to a bed that
// did not exist yet. Mirrors the bedsAvailableAt exclusion condition. Read-only;
// fix flagged rows by hand in the ReviewTab.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .env.local`); process.exit(1); }
  return v;
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { data: zones, error: zErr } = await supabase
    .from("zones")
    .select("id, slug, established_at")
    .not("established_at", "is", null);
  if (zErr) throw zErr;

  let total = 0;
  for (const z of zones) {
    // taken_at strictly before the bed's established date = photo predates the bed.
    const { data: rows, error: pErr } = await supabase
      .from("zone_photos")
      .select("id, storage_path, taken_at")
      .eq("zone_id", z.id)
      .eq("review_status", "confirmed")
      .not("taken_at", "is", null)
      .lt("taken_at", z.established_at)
      .order("taken_at");
    if (pErr) throw pErr;
    if (rows.length === 0) continue;

    console.log(`\n${z.slug} (established ${z.established_at}) — ${rows.length} confirmed photo(s) predate it:`);
    for (const r of rows) {
      console.log(`  ${r.taken_at.slice(0, 10)}  ${r.id}  ${r.storage_path}`);
    }
    total += rows.length;
  }

  console.log(total === 0
    ? "\nClean — no confirmed photo predates its bed's established_at."
    : `\n${total} confirmed photo(s) flagged. Reassign them by hand in the ReviewTab.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
