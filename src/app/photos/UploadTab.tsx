"use client";
import { useState } from "react";
import type { Zone } from "@/lib/types";
import { sortZonesByName } from "@/lib/zones";
import { getExifDateTaken } from "@/lib/exif";
import { MODEL } from "@/lib/zone-classifier.mjs";

type Classification = {
  is_yard: boolean;
  zone_slug: string | null;
  area: string | null;
  confidence: number;
  caption: string;
  reasoning: string;
  tags: string[];
  plants: string[];
  hardscape: Record<string, boolean>;
  botanical: { bloom_colors?: string[]; notes?: string };
  quality?: string;
};

type Item = {
  uid: string;
  file: File;
  storagePath: string;
  takenAt: string | null;
  status: "classifying" | "ready" | "error" | "saved";
  ai?: Classification;
  chosenZoneId: string;
  skip: boolean;
};

async function uploadAndClassify(file: File): Promise<{ storagePath: string; ai: Classification }> {
  const urlRes = await fetch(`/api/zone-photos/upload-url?filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "image/jpeg")}`);
  if (!urlRes.ok) throw new Error(await urlRes.text());
  const { signedUrl, path } = (await urlRes.json()) as { signedUrl: string; path: string };

  const put = await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
  if (!put.ok) throw new Error(`storage upload failed: ${put.status}`);

  const clsRes = await fetch("/api/zone-photos/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storage_path: path }),
  });
  if (!clsRes.ok) throw new Error(await clsRes.text());
  return { storagePath: path, ai: (await clsRes.json()) as Classification };
}

export default function UploadTab({ zones }: { zones: Zone[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const zoneIdBySlug = new Map(zones.map((z) => [z.slug, z.id]));
  const zonesAlpha = sortZonesByName(zones);

  async function onFiles(files: File[]) {
    for (const file of files) {
      const uid = crypto.randomUUID();
      const takenAt = await getExifDateTaken(file);
      setItems((prev) => [...prev, { uid, file, storagePath: "", takenAt, status: "classifying", chosenZoneId: "", skip: false }]);
      try {
        const { storagePath, ai } = await uploadAndClassify(file);
        setItems((prev) => prev.map((it) => it.uid === uid ? {
          ...it, storagePath, ai, status: "ready" as const,
          chosenZoneId: (ai.zone_slug && zoneIdBySlug.get(ai.zone_slug)) || "",
          skip: ai.is_yard === false,
        } : it));
      } catch {
        setItems((prev) => prev.map((it) => it.uid === uid ? { ...it, status: "error" as const } : it));
      }
    }
  }

  async function saveOne(uid: string) {
    const it = items.find((x) => x.uid === uid);
    if (!it || !it.ai || !it.chosenZoneId) return;
    const zone = zones.find((z) => z.id === it.chosenZoneId);
    const res = await fetch("/api/zone-photos/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zone_id: it.chosenZoneId,
        storage_path: it.storagePath,
        caption: it.ai.caption || null,
        taken_at: it.takenAt,
        area: zone?.area ?? it.ai.area ?? null,
        review_status: "confirmed",
        source: "manual",
        ai_zone_slug: it.ai.zone_slug,
        ai_area: it.ai.area,
        ai_confidence: it.ai.confidence,
        ai_model: MODEL,
        is_yard: it.ai.is_yard,
        ai_meta: {
          quality: it.ai.quality,
          reasoning: it.ai.reasoning,
          tags: it.ai.tags,
          plants: it.ai.plants,
          hardscape: it.ai.hardscape,
          botanical: it.ai.botanical,
          capture_source: "upload",
        },
      }),
    });
    if (res.ok) setItems((prev) => prev.map((x) => (x.uid === uid ? { ...x, status: "saved" as const } : x)));
  }

  const saveAll = () => items.forEach((it) => it.status === "ready" && !it.skip && it.chosenZoneId && saveOne(it.uid));
  const savable = items.filter((it) => it.status === "ready" && !it.skip && it.chosenZoneId).length;

  return (
    <div data-testid="tab-upload">
      <label style={{ display: "block", border: "2px dashed #cbb994", borderRadius: 12, padding: 22, textAlign: "center", background: "#f5efe0", cursor: "pointer", marginBottom: 12 }}>
        <div style={{ fontSize: 14, color: "#3f4a2e" }}>Drop new photos here — Claude sorts them into zones</div>
        <div style={{ fontSize: 11, color: "#8a8268" }}>classified server-side · you confirm each suggestion</div>
        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ""; }} />
      </label>

      {items.map((it) => (
        <div key={it.uid} style={{ display: "flex", gap: 10, alignItems: "center", background: "#f5efe0", border: `1px solid ${it.skip ? "#d8b58c" : "#cbb994"}`, borderRadius: 10, padding: 8, marginBottom: 6, opacity: it.status === "saved" ? 0.5 : 1 }}>
          <div style={{ flex: 1, fontSize: 12 }}>
            <div style={{ color: "#8a8268" }}>{it.file.name}{it.takenAt ? ` · ${it.takenAt.slice(0, 10)}` : ""}</div>
            {it.status === "classifying" && <div style={{ color: "#7a6a44" }}>Classifying…</div>}
            {it.status === "error" && <div style={{ color: "#8e3b5e" }}>Classify failed — pick a zone manually</div>}
            {it.ai && it.skip && <div style={{ color: "#8a5a2e" }}>doesn&#39;t look like the yard — skip?</div>}
            {it.ai && !it.skip && <div style={{ color: "#3f4a2e" }}>AI: <b>{it.ai.zone_slug ?? "—"}</b> ({it.ai.area ?? "—"}) · conf {it.ai.confidence.toFixed(2)}</div>}
          </div>
          {it.status !== "saved" && (
            <>
              <select value={it.chosenZoneId} onChange={(e) => setItems((prev) => prev.map((x) => (x.uid === it.uid ? { ...x, chosenZoneId: e.target.value } : x)))} style={{ fontSize: 12, border: "1px solid #cbb994", borderRadius: 8, background: "#fff", padding: "4px 6px" }}>
                <option value="">choose zone…</option>
                {zonesAlpha.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              {it.skip
                ? <button onClick={() => setItems((prev) => prev.filter((x) => x.uid !== it.uid))} style={{ fontSize: 12, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 8, padding: "5px 9px", cursor: "pointer" }}>Skip</button>
                : <button onClick={() => saveOne(it.uid)} disabled={!it.chosenZoneId} style={{ fontSize: 12, border: "none", background: "#8e3b5e", color: "#fff", borderRadius: 8, padding: "5px 9px", cursor: "pointer" }}>Save</button>}
            </>
          )}
          {it.status === "saved" && <span style={{ fontSize: 12, color: "#3f4a2e" }}>saved ✓</span>}
        </div>
      ))}

      {savable > 1 && (
        <button onClick={saveAll} style={{ background: "#8e3b5e", border: "none", color: "#fff", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", marginTop: 6 }}>
          Save {savable} photos to their zones
        </button>
      )}
    </div>
  );
}
