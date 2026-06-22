import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: { zone_id?: string; storage_path?: string; taken_at?: string; caption?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const { zone_id, storage_path, taken_at, caption } = body;
  if (!zone_id || !storage_path) {
    return NextResponse.json({ error: "zone_id and storage_path required" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("zone_photos")
    .insert({
      zone_id,
      storage_path,
      caption: caption?.trim() || null,
      taken_at: taken_at ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
