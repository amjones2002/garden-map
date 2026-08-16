import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";

/**
 * Delete a zone photo by id (?id=), or a bare storage object by path (?path=).
 *
 * The path form exists for the upload flow: the Upload tab pushes a file to
 * storage before a zone is chosen, so skipping or removing an item has to clean
 * up an object that no row references yet. Without it, every skipped upload
 * leaks a file that nothing in the app can ever reach.
 */
export async function DELETE(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  const path = params.get("path");

  const supabase = getServerSupabase();

  if (path) {
    // Only ever an unreferenced object: refuse if a row has claimed it.
    const { data: claimed } = await supabase
      .from("zone_photos").select("id").eq("storage_path", path).maybeSingle();
    if (claimed) {
      return NextResponse.json({ error: "path belongs to a saved photo; delete by id" }, { status: 409 });
    }
    const { error } = await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([path]);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: "id or path required" }, { status: 400 });

  const { data: row } = await supabase.from("zone_photos").select("storage_path").eq("id", id).single();
  if (row?.storage_path) {
    await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([row.storage_path]);
  }
  const { error } = await supabase.from("zone_photos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
