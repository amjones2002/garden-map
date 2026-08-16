import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";
import { planReviewUpdate, type ReviewAction } from "@/lib/zone-photos-review";
import type { Zone } from "@/lib/types";

type Body = { ids?: string[]; action?: ReviewAction; zone_id?: string };

export async function PATCH(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const { ids, action, zone_id } = body;
  if (!Array.isArray(ids) || ids.length === 0 || !action) {
    return NextResponse.json({ error: "ids[] and action required" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data: zones, error: zErr } = await supabase.from("zones").select("id, slug, name, area");
  if (zErr) return NextResponse.json({ error: zErr.message }, { status: 400 });

  const plan = planReviewUpdate({ action, zoneId: zone_id ?? null, zones: (zones ?? []) as Zone[] });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  // A rejected photo is never rendered again — every read path filters to
  // 'confirmed' or 'pending', and the GPS re-run skips human-reviewed rows — so
  // its storage object is dead weight. Read the paths before the update, drop
  // the objects after it succeeds, and keep the rows: `source_ref` carries a
  // unique index that stops `import:photos` re-importing the same photo.
  const rejecting = plan.patch.review_status === "rejected";
  const paths = rejecting
    ? ((await supabase.from("zone_photos").select("storage_path").in("id", ids)).data ?? [])
        .map((r) => r.storage_path)
        .filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];

  const patch = { ...plan.patch, reviewed_at: new Date().toISOString() };
  const { error, count } = await supabase
    .from("zone_photos")
    .update(patch, { count: "exact" })
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (paths.length) {
    await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove(paths);
  }

  return NextResponse.json({ updated: count ?? ids.length });
}
