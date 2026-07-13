import { getServerSupabase } from "@/lib/supabase/server";
import { deriveFacet, type PhotoFacet } from "@/lib/photo-facets";
import { ERAS } from "@/lib/eras.data";
import type { Zone, ZonePhoto } from "@/lib/types";
import GalleryBrowser from "./GalleryBrowser";

export const dynamic = "force-dynamic";

async function loadConfirmed(sb: ReturnType<typeof getServerSupabase>): Promise<ZonePhoto[]> {
  const out: ZonePhoto[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("zone_photos").select("*")
      .eq("review_status", "confirmed")
      .order("taken_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ZonePhoto[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default async function GalleryPage() {
  const sb = getServerSupabase();
  const [{ data: zones }, photos] = await Promise.all([
    sb.from("zones").select("*"),
    loadConfirmed(sb),
  ]);
  const facets: PhotoFacet[] = photos.map((p) => deriveFacet(p, (zones ?? []) as Zone[], ERAS));
  return <GalleryBrowser facets={facets} />;
}
