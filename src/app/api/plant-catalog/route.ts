import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeQuery, rankCatalogResults, type CatalogResult } from "@/lib/plant-catalog";

/** Public search over the plant catalog. GET ?q=<text>. Returns up to 20 ranked matches. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const q = sanitizeQuery(raw);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("plant_catalog")
    .select("id, scientific_name, common_name, other_common_names")
    .or(`common_name.ilike.%${q}%,scientific_name.ilike.%${q}%`)
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const results = rankCatalogResults((data ?? []) as CatalogResult[], q);
  return NextResponse.json({ results });
}
