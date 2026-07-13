import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";
import { buildConfirmRow, type ConfirmBody } from "@/lib/zone-photos-write";

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const built = buildConfirmRow(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  if (built.row.review_status === "confirmed") {
    built.row.reviewed_at = new Date().toISOString();
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("zone_photos").insert(built.row).select().single();

  if (error) {
    if (typeof built.row.storage_path === "string") {
      await supabase.storage.from(ZONE_PHOTOS_BUCKET).remove([built.row.storage_path]);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
