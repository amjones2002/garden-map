import { redirect } from "next/navigation";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { groupPendingByAreaZone } from "@/lib/zones";
import type { Zone, ZonePhoto } from "@/lib/types";
import PhotosTabs from "./PhotosTabs";

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await requireEdit())) redirect("/");

  const { tab } = await searchParams;
  const initialTab = tab === "review" ? "review" : "upload";

  const supabase = getServerSupabase();
  const [{ data: zones }, { data: pending }] = await Promise.all([
    supabase.from("zones").select("*").is("archived_at", null).order("sort_order"),
    supabase.from("zone_photos").select("*").eq("review_status", "pending"),
  ]);

  const zoneList = (zones ?? []) as Zone[];
  const pendingList = (pending ?? []) as ZonePhoto[];
  const sections = groupPendingByAreaZone(pendingList, zoneList);

  return (
    <PhotosTabs
      sections={sections}
      zones={zoneList}
      pendingCount={pendingList.length}
      initialTab={initialTab}
    />
  );
}
