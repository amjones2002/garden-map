import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

type ZonePatch = {
  id?: string;
  shape?: { x: number; y: number }[];
  description?: string;
  label?: string;
  fill_color?: string;
};

/** Update a zone (shape and/or label/description/color). Gated. */
export async function PATCH(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: ZonePatch = {};
  try {
    body = await req.json();
  } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (Array.isArray(body.shape)) update.shape = body.shape;
  if (typeof body.description === "string") update.description = body.description;
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.fill_color === "string") update.fill_color = body.fill_color;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("zones").update(update).eq("id", body.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
