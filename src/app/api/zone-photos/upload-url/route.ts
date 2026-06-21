import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";

export async function GET(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const zone_id = searchParams.get("zone_id");
  const filename = searchParams.get("filename");
  const type = searchParams.get("type") ?? "image/jpeg";

  if (!zone_id || !filename) {
    return NextResponse.json({ error: "zone_id and filename required" }, { status: 400 });
  }

  const ext = (filename.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${zone_id}/${crypto.randomUUID()}.${ext}`;

  const supabase = getServerSupabase();
  const { data, error } = await supabase.storage
    .from(ZONE_PHOTOS_BUCKET)
    .createSignedUploadUrl(path);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ signedUrl: data.signedUrl, path });
}
