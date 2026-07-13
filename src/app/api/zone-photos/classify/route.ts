import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import exifr from "exifr";
import { requireEdit } from "@/lib/require-edit";
import { getServerSupabase } from "@/lib/supabase/server";
import { ZONE_PHOTOS_BUCKET } from "@/lib/photos";
import { resolveGpsHint } from "@/lib/georeference.mjs";
import {
  buildSystemPrompt,
  buildClassificationSchema,
  classifyImage,
  gpsPriorText,
} from "@/lib/zone-classifier.mjs";

// sharp (native) + a live vision call need the Node runtime, not edge.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await requireEdit())) return NextResponse.json({ error: "locked" }, { status: 401 });

  let body: { storage_path?: string };
  try {
    body = (await req.json()) as { storage_path?: string };
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  const storage_path = body.storage_path;
  if (!storage_path) return NextResponse.json({ error: "storage_path required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "classifier not configured" }, { status: 500 });

  const supabase = getServerSupabase();

  const { data: blob, error: dlErr } = await supabase.storage.from(ZONE_PHOTOS_BUCKET).download(storage_path);
  if (dlErr || !blob) return NextResponse.json({ error: "could not read image" }, { status: 404 });

  const input = Buffer.from(await blob.arrayBuffer());
  const downscaled = await sharp(input).rotate().resize(1568, 1568, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const base64Image = downscaled.toString("base64");

  const { data: zones, error: zErr } = await supabase.from("zones").select("slug, name, area, description");
  if (zErr) return NextResponse.json({ error: zErr.message }, { status: 400 });

  let gpsHint = null;
  try {
    const gps = await exifr.gps(input);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      const { data: geo } = await supabase.from("map_georeference").select("*").eq("id", 1).maybeSingle();
      if (geo) {
        const { data: zonesGeo } = await supabase
          .from("zones").select("slug, area, shape").not("area", "is", null);
        gpsHint = resolveGpsHint(geo, gps.latitude, gps.longitude, zonesGeo ?? []);
      }
    }
  } catch {
    // no GPS / no transform — fall back to vision-only
  }

  const systemPrompt = buildSystemPrompt(zones ?? []) + gpsPriorText(gpsHint);
  const schema = buildClassificationSchema((zones ?? []).map((z: { slug: string }) => z.slug));

  try {
    const client = new Anthropic({ apiKey });
    const result = await classifyImage(client, { systemPrompt, schema, base64Image, mediaType: "image/jpeg" });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "classify failed" }, { status: 502 });
  }
}
