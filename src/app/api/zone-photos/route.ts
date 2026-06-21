import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";

/** Upload a zone photo (multipart form: file, zone_id, caption?, taken_at?). Gated. */
export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  const zone_id = form.get("zone_id");
  const caption = form.get("caption");
  const taken_at = form.get("taken_at");

  if (!(file instanceof File) || typeof zone_id !== "string" || !zone_id) {
    return NextResponse.json({ error: "file and zone_id required" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${zone_id}/${crypto.randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const supabase = getServerSupabase();
  const { error: upErr } = await supabase.storage
    .from(ZONE_PHOTOS_BUCKET)
    .upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const { data, error } = await supabase
    .from("zone_photos")
    .insert({
      zone_id,
      storage_path: path,
      caption: typeof caption === "string" && caption.trim() ? caption.trim() : null,
      taken_at: typeof taken_at === "string" && taken_at ? taken_at : null,
    })
    .select()
    .single();
  if (error) {
    // best-effort cleanup of the orphaned object
    await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

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
