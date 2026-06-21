import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

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

// Placeholder rectangles in normalized 0..1 coords; refined later in the shape editor.
const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

// Placeholder positions in the survey-traced layout (normalized 0..1). Refine in the editor.
const ZONES = [
  { slug: "hellstrip",        name: "Hellstrip",             label: "Hellstrip",       fill_color: "#9bbf4a", sort_order: 1, shape: rect(0.10, 0.74, 0.16, 0.11), description: "Curved corner bed in the frontage parkway (outside the property line): frog fruit, bluebonnets, black-eyed Susans, echinacea." },
  { slug: "foundation-bed",   name: "Foundation Bed",        label: "Foundation Bed",  fill_color: "#7aa329", sort_order: 2, shape: rect(0.385, 0.578, 0.305, 0.035), description: "~50 ft bed along the house: Taylor Junipers, Canyon Creek & Kaleidoscope Abelias, liriope/dwarf mondo, asparagus." },
  { slug: "cedar-planters",   name: "Cedar Planters",        label: "Cedar Planters",  fill_color: "#b5651d", sort_order: 3, shape: rect(0.61, 0.41, 0.12, 0.085), description: "Two raised beds on the covered pool patio: herbs and ornamentals." },
  { slug: "pool-spa",         name: "Pool & Spa",            label: "Pool",            fill_color: "#4aa3bf", sort_order: 4, shape: rect(0.72, 0.285, 0.185, 0.155), description: "Pool and spa." },
  { slug: "dry-mineral-bed",  name: "Dry Mineral Bed",       label: "Dry Mineral Bed", fill_color: "#c9a14a", sort_order: 5, shape: rect(0.30, 0.605, 0.10, 0.085), description: "Sotol, Penstemon baccharifolius, Asclepias tuberosa." },
  { slug: "front-raised-bed", name: "Front Raised Bed (8x3)", label: "Raised Bed",     fill_color: "#8e3b5e", sort_order: 6, shape: rect(0.45, 0.635, 0.10, 0.06), description: "8x3 raised bed: giant coneflowers, Turk's cap, homestead verbena." },
  { slug: "north-side-yard",  name: "North Side Yard",       label: "North Side",      fill_color: "#6fae3f", sort_order: 7, shape: rect(0.40, 0.255, 0.29, 0.035), description: "Summer annuals, catmint, dwarf sunflowers." },
  { slug: "stock-tank",       name: "Stock Tank Fountain",   label: "Stock Tank",      fill_color: "#5e8c6a", sort_order: 8, shape: rect(0.265, 0.49, 0.07, 0.08), description: "Stock tank fountain: milkweed and monarch habitat." },
];

const VENDORS = [
  { name: "Data Migration", notes: "Placeholder vendor for imported records with unknown source.", sort_order: 99 },
];

async function main() {
  const { error: zErr } = await supabase.from("zones").upsert(ZONES, { onConflict: "slug" });
  if (zErr) throw zErr;
  console.log(`Upserted ${ZONES.length} zones.`);

  const { error: vErr } = await supabase.from("vendors").upsert(VENDORS, { onConflict: "name" });
  if (vErr) throw vErr;
  console.log(`Upserted ${VENDORS.length} vendors.`);
  console.log("Zone/vendor seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
