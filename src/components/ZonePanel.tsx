"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useEditMode } from "@/lib/edit-mode";
import type { Zone, Purchase, ZonePhoto } from "@/lib/types";
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
  const [planted, setPlanted] = useState<Purchase[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [photos, setPhotos] = useState<ZonePhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ total: number; done: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [planted, pu, ph] = await Promise.all([
      sb.from("purchases").select("*").eq("zone_id", zone.id).eq("status", "planted").order("common_name"),
      sb.from("purchases").select("*").eq("zone_id", zone.id).order("created_at", { ascending: false }).limit(5),
      sb.from("zone_photos").select("*").eq("zone_id", zone.id),
    ]);
    setPlanted((planted.data ?? []) as Purchase[]);
    setPurchases((pu.data ?? []) as Purchase[]);
    setPhotos(sortChronological((ph.data ?? []) as ZonePhoto[]));
  }, [zone.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadPhotos(files: File[]) {
    setUploadError(null);
    setUploadProgress({ total: files.length, done: 0 });
    let successCount = 0;

    await Promise.all(
      files.map(async (file) => {
        try {
          const urlRes = await fetch(
            `/api/zone-photos/upload-url?zone_id=${encodeURIComponent(zone.id)}&filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || "image/jpeg")}`,
          );
          if (!urlRes.ok) throw new Error(await urlRes.text());
          const { signedUrl, path } = (await urlRes.json()) as { signedUrl: string; path: string };

          const putRes = await fetch(signedUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type || "image/jpeg" },
          });
          if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`);

          const confirmRes = await fetch("/api/zone-photos/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              zone_id: zone.id,
              storage_path: path,
              taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
            }),
          });
          if (!confirmRes.ok) throw new Error(await confirmRes.text());

          const newPhoto = (await confirmRes.json()) as ZonePhoto;
          setPhotos((prev) => sortChronological([...prev, newPhoto]));
          successCount++;
        } catch (err) {
          console.error("Photo upload failed:", err);
        } finally {
          setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
        }
      }),
    );

    setUploadProgress(null);
    if (successCount === 0) setUploadError("Upload failed — please try again.");
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
          <div style={{ marginTop: 6 }}>
            <label
              style={{
                display: "inline-block",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbb994",
                background: "#e3dac3",
                cursor: uploadProgress ? "default" : "pointer",
                fontSize: 13,
                opacity: uploadProgress ? 0.7 : 1,
              }}
            >
              {uploadProgress
                ? `Uploading ${uploadProgress.done} of ${uploadProgress.total}…`
                : "+ Add photos"}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={!!uploadProgress}
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) uploadPhotos(files);
                  e.target.value = "";
                }}
              />
            </label>
            {uploadError && (
              <p style={{ color: "#8e3b5e", fontSize: 12, margin: "4px 0 0" }}>{uploadError}</p>
            )}
          </div>
        )}

        <h3 style={{ color: "#7a6a44", marginBottom: 4, marginTop: 16 }}>Currently planted</h3>
        {planted.length === 0 && <p style={{ color: "#8a8268", margin: 0 }}>No plants listed yet.</p>}
        <ul style={{ marginTop: 4 }}>
          {planted.map((p) => (
            <li key={p.id}>
              {p.common_name}
              {p.botanical_name ? <em style={{ color: "#8a8268" }}> — {p.botanical_name}</em> : null}
              {p.purchase_date ? <span style={{ color: "#8a8268" }}> · {p.purchase_date}</span> : null}
            </li>
          ))}
        </ul>

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
