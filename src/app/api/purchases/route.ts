import { NextResponse } from "next/server";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { PURCHASE_STATUSES } from "@/lib/purchases";

type PurchaseInput = {
  common_name?: string;
  botanical_name?: string | null;
  zone_id?: string | null;
  vendor_id?: string | null;
  catalog_id?: string | null;
  purchase_date?: string | null;
  price?: number | null;
  price_estimated?: boolean;
  quantity?: number;
  status?: string;
  notes?: string | null;
  also_add_to_plant_list?: boolean;
};

function cleanFields(b: PurchaseInput) {
  const status = b.status && (PURCHASE_STATUSES as readonly string[]).includes(b.status) ? b.status : "planted";
  return {
    common_name: (b.common_name ?? "").trim(),
    botanical_name: b.botanical_name ?? null,
    zone_id: b.zone_id ?? null,
    vendor_id: b.vendor_id ?? null,
    catalog_id: b.catalog_id ?? null,
    purchase_date: b.purchase_date || null,
    price: typeof b.price === "number" ? b.price : null,
    price_estimated: !!b.price_estimated,
    quantity: typeof b.quantity === "number" && b.quantity > 0 ? b.quantity : 1,
    status,
    notes: b.notes ?? null,
  };
}

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: PurchaseInput = {};
  try {
    body = await req.json();
  } catch {}
  const fields = cleanFields(body);
  if (!fields.common_name) return NextResponse.json({ error: "common_name required" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("purchases").insert(fields).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Optionally mirror into the zone's curated plant list.
  if (body.also_add_to_plant_list && fields.zone_id) {
    await supabase.from("plants").insert({
      zone_id: fields.zone_id,
      common_name: fields.common_name,
      botanical_name: fields.botanical_name,
      catalog_id: fields.catalog_id,
    });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  let body: PurchaseInput & { id?: string } = {};
  try {
    body = await req.json();
  } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const fields = cleanFields(body);
  if (!fields.common_name) return NextResponse.json({ error: "common_name required" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("purchases")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = getServerSupabase();
  const { error } = await supabase.from("purchases").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
