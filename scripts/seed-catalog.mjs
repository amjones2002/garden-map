import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseNpsot } from "./lib/parse-npsot.mjs";
import { parseWildflower } from "./lib/parse-wildflower.mjs";
import { mergeCatalog } from "./lib/merge-catalog.mjs";

// Next.js stores local env in .env.local; load that (then plain .env as fallback).
config({ path: ".env.local" });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Clean ecoregion labels keyed by WildflowersOrg filename (without extension).
const ECOREGION_FILES = {
  "Arizona and New Mexico Mountains": "Arizona and New Mexico Mountains",
  "Central Great Plains": "Central Great Plains",
  "Chihuahuan Desert": "Chihuahuan Desert",
  "Cross Timbers": "Cross Timbers",
  "East Central Texas Plains": "East Central Texas Plains",
  "Edwards Plateau": "Edwards Plateau",
  "High Plains": "High Plains",
  SouthCentralPlains: "South Central Plains",
  "Southern Texas Plains": "Southern Texas Plains",
  "Southwestern Tablelands": "Southwestern Tablelands",
  "Texas Blackland Prairies": "Texas Blackland Prairies",
  "Western Gulf Coastal Plain": "Western Gulf Coastal Plain",
};

async function main() {
  const npsotRows = parseNpsot(fs.readFileSync("NPSOT/plant-list.csv", "utf8"));
  console.log("NPSOT rows:", npsotRows.length);

  let wildRows = [];
  for (const file of fs.readdirSync("WildflowersOrg")) {
    if (!file.endsWith(".htm")) continue;
    const base = path.basename(file, ".htm");
    const ecoregion = ECOREGION_FILES[base] || base;
    const html = fs.readFileSync(path.join("WildflowersOrg", file), "utf8");
    wildRows = wildRows.concat(parseWildflower(html, ecoregion));
  }
  console.log("Wildflower rows:", wildRows.length);

  const merged = mergeCatalog(npsotRows, wildRows);
  console.log("Merged catalog rows:", merged.length);

  // Idempotent reset
  const { error: delErr } = await supabase
    .from("plant_catalog")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) throw delErr;

  for (let i = 0; i < merged.length; i += 500) {
    const batch = merged.slice(i, i + 500);
    const { error } = await supabase.from("plant_catalog").insert(batch);
    if (error) throw error;
    console.log(`inserted ${Math.min(i + 500, merged.length)}/${merged.length}`);
  }
  console.log("Catalog seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
