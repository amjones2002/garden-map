import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

type LabelBody = {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
  font_size?: number;
  color?: string;
  rotation?: number;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Create a map text label. Gated. */
export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: LabelBody = {};
  try {
    body = await req.json();
  } catch {}
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("map_labels")
    .insert({
      text,
      x: clamp01(typeof body.x === "number" ? body.x : 0.5),
      y: clamp01(typeof body.y === "number" ? body.y : 0.5),
      font_size: typeof body.font_size === "number" ? body.font_size : 30,
      color: body.color ?? null,
      rotation: typeof body.rotation === "number" ? body.rotation : 0,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

/** Update a label (text/position/size/color). Gated. */
export async function PATCH(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: LabelBody = {};
  try {
    body = await req.json();
  } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.text === "string" && body.text.trim()) update.text = body.text.trim();
  if (typeof body.x === "number") update.x = clamp01(body.x);
  if (typeof body.y === "number") update.y = clamp01(body.y);
  if (typeof body.font_size === "number") update.font_size = body.font_size;
  if (typeof body.rotation === "number") update.rotation = body.rotation;
  if (typeof body.color === "string") update.color = body.color;
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("map_labels").update(update).eq("id", body.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

/** Delete a label by id (?id=). Gated. */
export async function DELETE(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = getServerSupabase();
  const { error } = await supabase.from("map_labels").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
