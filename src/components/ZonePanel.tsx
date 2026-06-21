"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useEditMode } from "@/lib/edit-mode";
import type { Zone, Plant, Purchase, ZonePhoto } from "@/lib/types";
import { publicPhotoUrl, sortChronological } from "@/lib/photos";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(40,36,28,0.35)",
  zIndex: 70,
  display: "flex",
  alignItems: "flex-end",
};

const sheet: React.CSSProperties = {
  background: "#f5efe0",
  width: "100%",
  maxHeight: "80vh",
  overflowY: "auto",
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  padding: 16,
  boxShadow: "0 -4px 20px rgba(0,0,0,0.25)",
};

export default function ZonePanel({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const { unlocked } = useEditMode();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [photos, setPhotos] = useState<ZonePhoto[]>([]);
  const [newPlant, setNewPlant] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [p, pu, ph] = await Promise.all([
      sb.from("plants").select("*").eq("zone_id", zone.id).order("sort_order"),
      sb.from("purchases").select("*").eq("zone_id", zone.id).order("created_at", { ascending: false }).limit(5),
      sb.from("zone_photos").select("*").eq("zone_id", zone.id),
    ]);
    setPlants((p.data ?? []) as Plant[]);
    setPurchases((pu.data ?? []) as Purchase[]);
    setPhotos(sortChronological((ph.data ?? []) as ZonePhoto[]));
  }, [zone.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addPlant() {
    const name = newPlant.trim();
    if (!name) return;
    setBusy(true);
    await fetch("/api/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_id: zone.id, common_name: name }),
    });
    setNewPlant("");
    setBusy(false);
    load();
  }

  async function removePlant(id: string) {
    setBusy(true);
    await fetch(`/api/plants?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("zone_id", zone.id);
    // Use the file's last-modified date as the capture date (EXIF can refine later).
    if (file.lastModified) fd.append("taken_at", new Date(file.lastModified).toISOString());
    await fetch("/api/zone-photos", { method: "POST", body: fd });
    setUploading(false);
    load();
  }

  async function removePhoto(id: string) {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/zone-photos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  const fmtDate = (p: ZonePhoto) => {
    const d = p.taken_at ?? p.uploaded_at;
    return d ? new Date(d).toLocaleDateString() : "";
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, color: "#3f4a2e" }}>{zone.name}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ minHeight: 36, minWidth: 36, border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        {zone.description && <p style={{ color: "#5a5340" }}>{zone.description}</p>}

        <h3 style={{ color: "#7a6a44", marginBottom: 4 }}>Photos</h3>
        {photos.length === 0 && <p style={{ color: "#8a8268", margin: 0 }}>No photos yet.</p>}
        {photos.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {photos.map((ph) => (
              <figure key={ph.id} style={{ margin: 0, flex: "0 0 auto", width: 140 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicPhotoUrl(SUPABASE_URL, ph.storage_path)}
                  alt={ph.caption ?? `${zone.name} photo`}
                  style={{ width: 140, height: 105, objectFit: "cover", borderRadius: 8, border: "1px solid #cbb994" }}
                />
                <figcaption style={{ fontSize: 11, color: "#8a8268", display: "flex", justifyContent: "space-between", gap: 4 }}>
                  <span>{fmtDate(ph)}</span>
                  {unlocked && (
                    <button onClick={() => removePhoto(ph.id)} style={{ border: "none", background: "transparent", color: "#8e3b5e", cursor: "pointer", fontSize: 11 }}>
                      delete
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {unlocked && (
          <label style={{ display: "inline-block", marginTop: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid #cbb994", background: "#e3dac3", cursor: "pointer", fontSize: 13 }}>
            {uploading ? "Uploading…" : "+ Add photo"}
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
                e.target.value = "";
              }}
            />
          </label>
        )}

        <h3 style={{ color: "#7a6a44", marginBottom: 4, marginTop: 16 }}>Currently planted</h3>
        {plants.length === 0 && <p style={{ color: "#8a8268", margin: 0 }}>No plants listed yet.</p>}
        <ul style={{ marginTop: 4 }}>
          {plants.map((p) => (
            <li key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>
                {p.common_name}
                {p.botanical_name ? <em style={{ color: "#8a8268" }}> — {p.botanical_name}</em> : null}
              </span>
              {unlocked && (
                <button onClick={() => removePlant(p.id)} disabled={busy} aria-label={`Remove ${p.common_name}`} style={{ border: "none", background: "transparent", color: "#8e3b5e", cursor: "pointer" }}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {unlocked && (
          <form
            style={{ display: "flex", gap: 6, marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              addPlant();
            }}
          >
            <input
              value={newPlant}
              onChange={(e) => setNewPlant(e.target.value)}
              placeholder="add a plant…"
              aria-label="add a plant"
              style={{ flex: 1, minHeight: 38, padding: "6px 10px", borderRadius: 8, border: "1px solid #cbb994" }}
            />
            <button type="submit" disabled={busy} style={{ minHeight: 38, padding: "0 12px", borderRadius: 8, border: "1px solid #cbb994", background: "#9bbf4a", cursor: "pointer" }}>
              Add
            </button>
          </form>
        )}

        <h3 style={{ color: "#7a6a44", marginBottom: 4, marginTop: 16 }}>Recent purchases</h3>
        {purchases.length === 0 && <p style={{ color: "#8a8268", margin: 0 }}>No purchases logged for this zone yet.</p>}
        <ul style={{ marginTop: 4 }}>
          {purchases.map((p) => (
            <li key={p.id}>
              {p.common_name}
              {p.purchase_date ? <span style={{ color: "#8a8268" }}> · {p.purchase_date}</span> : null}
              <span style={{ color: "#8a8268" }}> · {p.status}</span>
            </li>
          ))}
        </ul>

        <Link
          href={`/tracker?zone=${zone.slug}`}
          style={{ display: "inline-block", marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#8e3b5e", color: "#fff", textDecoration: "none" }}
        >
          + Add purchase
        </Link>
      </div>
    </div>
  );
}
