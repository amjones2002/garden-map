import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { normalizeImportRow, type ImportRow } from "@/lib/purchases";

const DATA_MIGRATION = "Data Migration";

/**
 * Import purchases from CSV text. POST { csv }.
 * `?dryRun=1` returns a parsed preview + warnings without inserting.
 */
export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  let csv = "";
  try {
    const body = await req.json();
    csv = typeof body?.csv === "string" ? body.csv : "";
  } catch {}
  if (!csv.trim()) return NextResponse.json({ error: "csv required" }, { status: 400 });

  let records: Record<string, unknown>[];
  try {
    records = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (e) {
    return NextResponse.json({ error: `CSV parse error: ${(e as Error).message}` }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { data: zones } = await supabase.from("zones").select("id, slug, name");
  const { data: vendors } = await supabase.from("vendors").select("id, name");

  const zoneBySlug = new Map((zones ?? []).map((z) => [z.slug.toLowerCase(), z.id]));
  const zoneByName = new Map((zones ?? []).map((z) => [z.name.toLowerCase(), z.id]));
  const vendorByName = new Map((vendors ?? []).map((v) => [v.name.toLowerCase(), v.id]));
  let dataMigrationId = vendorByName.get(DATA_MIGRATION.toLowerCase()) ?? null;

  const resolveZone = (ref: string | null): { id: string | null; warning?: string } => {
    if (!ref) return { id: null };
    const id = zoneBySlug.get(ref.toLowerCase()) ?? zoneByName.get(ref.toLowerCase());
    if (!id) return { id: null, warning: `Zone "${ref}" not found — imported unassigned` };
    return { id };
  };

  type Prepared = { row: ImportRow; zone_id: string | null; vendor_ref: string | null; warnings: string[] };
  const prepared: Prepared[] = [];
  const skipped: { warnings: string[] }[] = [];

  for (const rec of records) {
    const { row, warnings } = normalizeImportRow(rec);
    if (!row) {
      skipped.push({ warnings });
      continue;
    }
    const z = resolveZone(row.zone_ref);
    const w = [...warnings];
    if (z.warning) w.push(z.warning);
    prepared.push({ row, zone_id: z.id, vendor_ref: row.vendor_ref, warnings: w });
  }

  if (dryRun) {
    return NextResponse.json({
      preview: prepared.map((p) => ({
        common_name: p.row.common_name,
        zone_id: p.zone_id,
        vendor: p.vendor_ref ?? DATA_MIGRATION,
        price: p.row.price,
        price_estimated: p.row.price_estimated,
        status: p.row.status,
        warnings: p.warnings,
      })),
      willInsert: prepared.length,
      skipped: skipped.length,
    });
  }

  // Resolve / create vendors as needed.
  async function vendorId(ref: string | null): Promise<string | null> {
    const name = (ref ?? DATA_MIGRATION).trim();
    const existing = vendorByName.get(name.toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase.from("vendors").upsert({ name }, { onConflict: "name" }).select("id").single();
    if (error || !data) return dataMigrationId;
    vendorByName.set(name.toLowerCase(), data.id);
    if (name.toLowerCase() === DATA_MIGRATION.toLowerCase()) dataMigrationId = data.id;
    return data.id;
  }

  const toInsert = [];
  for (const p of prepared) {
    toInsert.push({
      common_name: p.row.common_name,
      botanical_name: p.row.botanical_name,
      zone_id: p.zone_id,
      vendor_id: await vendorId(p.vendor_ref),
      purchase_date: p.row.purchase_date,
      price: p.row.price,
      price_estimated: p.row.price_estimated,
      quantity: p.row.quantity,
      status: p.row.status,
      notes: p.row.notes,
    });
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500);
    const { error } = await supabase.from("purchases").insert(batch);
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 400 });
    inserted += batch.length;
  }
  return NextResponse.json({ inserted, skipped: skipped.length });
}
