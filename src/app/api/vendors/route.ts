import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";

/** Create a vendor. Gated: requires an unlocked edit session. */
export async function POST(req: Request) {
  if (!(await requireEdit())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  let body: { name?: string; url?: string; notes?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("vendors")
    .insert({ name, url: body.url ?? null, notes: body.notes ?? null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
