import { getServerSupabase } from "@/lib/supabase/server";
import { ERAS } from "@/lib/eras.data";
import { assignEra, groupBySeason } from "@/lib/eras.mjs";
import type { Zone, ZonePhoto } from "@/lib/types";
import TimelineView, { type TimelineEra } from "./TimelineView";

export const dynamic = "force-dynamic";

const CAP_PER_SEASON = 24; // keep the page light; deep browsing lives in /gallery

export default async function TimelinePage() {
  const sb = getServerSupabase();
  const [{ data: zones }, photos] = await Promise.all([
    sb.from("zones").select("*"),
    (async () => {
      const out: ZonePhoto[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("zone_photos").select("*")
          .eq("review_status", "confirmed").order("taken_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as ZonePhoto[]));
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
  ]);

  const zoneName = (id: string | null) => (zones as Zone[] | null)?.find((z) => z.id === id)?.name ?? null;
  const seasonLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace("-", " ");

  const eras: TimelineEra[] = ERAS.map((era) => {
    const inEra = photos.filter((p) => assignEra(p.taken_at ?? p.uploaded_at, ERAS) === era.key);
    const seasons = groupBySeason(inEra).map((g: { key: string; photos: ZonePhoto[] }) => ({
      key: g.key, label: seasonLabel(g.key),
      photos: g.photos.slice(0, CAP_PER_SEASON).map((p) => ({
        id: p.id, storagePath: p.storage_path, caption: p.caption, takenAt: p.taken_at,
        zoneName: zoneName(p.zone_id), quality: p.ai_meta?.quality ?? null,
        bloomColors: p.ai_meta?.botanical?.bloom_colors ?? [], reasoning: p.ai_meta?.reasoning ?? null,
      })),
    }));
    return { ...era, seasons };
  });

  return <TimelineView eras={eras} />;
}
