import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

type ZoneBody = {
  id?: string;
  name?: string;
  shape?: { x: number; y: number }[];
  description?: string;
  label?: string;
  fill_color?: string;
  archived?: boolean;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Create a new zone. Gated. */
export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: ZoneBody = {};
  try {
    body = await req.json();
  } catch {}
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const supabase = getServerSupabase();

  // Unique slug.
  const base = slugify(name) || "zone";
  const { data: existing } = await supabase.from("zones").select("slug, sort_order");
  const slugs = new Set((existing ?? []).map((z) => z.slug));
  let slug = base;
  for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
  const nextOrder = Math.max(0, ...(existing ?? []).map((z) => z.sort_order ?? 0)) + 1;

  const { data, error } = await supabase
    .from("zones")
    .insert({
      slug,
      name,
      label: body.label ?? name,
      description: body.description ?? null,
      fill_color: body.fill_color ?? "#7aa329",
      shape: Array.isArray(body.shape) ? body.shape : [],
      sort_order: nextOrder,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

/** Update a zone (shape, name/label/description/color) or archive/unarchive it. Gated. */
export async function PATCH(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: ZoneBody = {};
  try {
    body = await req.json();
  } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Array.isArray(body.shape)) update.shape = body.shape;
  if (typeof body.description === "string") update.description = body.description;
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.fill_color === "string") update.fill_color = body.fill_color;
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.archived === "boolean") update.archived_at = body.archived ? new Date().toISOString() : null;

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("zones").update(update).eq("id", body.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
