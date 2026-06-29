import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeQuery, rankCatalogResults, type CatalogResult } from "@/lib/plant-catalog";
import { searchUsdaPlants } from "@/lib/usda-plants";

const CATALOG_THRESHOLD = 5; // below this, supplement with USDA fallback
const MAX_RESULTS = 20;

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
    .limit(MAX_RESULTS);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const catalogResults = rankCatalogResults((data ?? []) as CatalogResult[], q);

  if (catalogResults.length >= CATALOG_THRESHOLD) {
    return NextResponse.json({ results: catalogResults });
  }

  // Supplement with USDA fallback
  const catalogSciNames = new Set(
    catalogResults.map((r) => r.scientific_name.toLowerCase())
  );
  const usdaLimit = MAX_RESULTS - catalogResults.length;
  const usdaRaw = searchUsdaPlants(q, usdaLimit * 2);

  const usdaResults: CatalogResult[] = usdaRaw
    .filter((r) => !catalogSciNames.has(r.scientific_name.toLowerCase()))
    .slice(0, usdaLimit)
    .map((r) => ({
      id: r.id,
      scientific_name: r.scientific_name,
      common_name: r.common_name,
      other_common_names: null,
      family: r.family,
      source: "usda" as const,
    }));

  return NextResponse.json({ results: [...catalogResults, ...usdaResults] });
}
