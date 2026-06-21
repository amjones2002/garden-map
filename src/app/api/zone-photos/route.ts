import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";

/** Delete a zone photo by id (?id=). Gated. */
export async function DELETE(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data: row } = await supabase.from("zone_photos").select("storage_path").eq("id", id).single();
  if (row?.storage_path) {
    await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([row.storage_path]);
  }
  const { error } = await supabase.from("zone_photos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
