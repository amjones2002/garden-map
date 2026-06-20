import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

/** Add a plant to a zone's curated list. Gated. */
export async function POST(req: Request) {
  if (!(await requireEdit())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  let body: { zone_id?: string; common_name?: string; botanical_name?: string; catalog_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty
  }
  const zone_id = body.zone_id;
  const common_name = (body.common_name ?? "").trim();
  if (!zone_id || !common_name) {
    return NextResponse.json({ error: "zone_id and common_name required" }, { status: 400 });
  }
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("plants")
    .insert({
      zone_id,
      common_name,
      botanical_name: body.botanical_name ?? null,
      catalog_id: body.catalog_id ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

/** Remove a plant from a zone's list by id (?id=). Gated. */
export async function DELETE(req: Request) {
  if (!(await requireEdit())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = getServerSupabase();
  const { error } = await supabase.from("plants").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
