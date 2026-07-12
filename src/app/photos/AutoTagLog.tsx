"use client";
import { useCallback, useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { publicPhotoUrl } from "@/lib/photos";
import type { Zone, ZonePhoto } from "@/lib/types";
import { sortZonesByName } from "@/lib/zones";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PAGE = 25;

export default function AutoTagLog({ zones }: { zones: Zone[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ZonePhoto[]>([]);
  const [page, setPage] = useState(0);
  const [zoneFilter, setZoneFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const nameById = new Map(zones.map((z) => [z.id, z.name]));
  const zonesAlpha = sortZonesByName(zones);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getBrowserSupabase();
    let q = sb
      .from("zone_photos")
      .select("*")
      .eq("review_status", "confirmed")
      .not("ai_zone_slug", "is", null)
      .order("taken_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (zoneFilter) q = q.eq("zone_id", zoneFilter);
    const { data } = await q;
    setRows((data ?? []) as ZonePhoto[]);
    setLoading(false);
  }, [page, zoneFilter]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const reopen = async (id: string, action: "reject" | "reassign", zone_id?: string) => {
    setReopenError(null);
    const res = await fetch("/api/zone-photos/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], action, zone_id }),
    });
    if (!res.ok) {
      setReopenError("Re-open failed — please try again.");
      return;
    }
    setRows((r) => r.filter((p) => p.id !== id));
  };

  return (
    <div style={{ borderTop: "1px solid #cbb994", paddingTop: 8, marginTop: 8 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "transparent", border: "none", color: "#7a6a44", fontSize: 13, cursor: "pointer" }}>
        Auto-tagged log {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <select value={zoneFilter} onChange={(e) => { setPage(0); setZoneFilter(e.target.value); }} style={{ fontSize: 12, marginBottom: 8, border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0", padding: "4px 8px" }}>
            <option value="">All zones</option>
            {zonesAlpha.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          {loading && <p style={{ fontSize: 12, color: "#8a8268" }}>Loading…</p>}
          {reopenError && <p style={{ fontSize: 12, color: "#8e3b5e" }}>{reopenError}</p>}
          {rows.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: 6, background: "#f5efe0", border: "1px solid #cbb994", borderRadius: 8, marginBottom: 5 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicPhotoUrl(SUPABASE_URL, p.storage_path)} alt="" style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 4, flex: "0 0 auto" }} />
              <div style={{ flex: 1 }}>
                <b>{p.ai_zone_slug}</b> · {p.ai_area ?? "—"} · conf {p.ai_confidence?.toFixed(2) ?? "—"} · {(p.taken_at ?? p.uploaded_at).slice(0, 10)}
                <span style={{ color: "#8a8268" }}> · now: {p.zone_id ? nameById.get(p.zone_id) ?? "—" : "—"}</span>
              </div>
              <select defaultValue="" onChange={(e) => e.target.value && reopen(p.id, "reassign", e.target.value)} aria-label="Reassign" style={{ fontSize: 11, border: "1px solid #cbb994", borderRadius: 6, background: "#fff" }}>
                <option value="">reassign…</option>
                {zonesAlpha.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <button onClick={() => reopen(p.id, "reject")} style={{ fontSize: 11, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 6, padding: "3px 7px", cursor: "pointer" }}>Reject</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 6 }}>
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={{ fontSize: 12, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>← Prev</button>
            <span style={{ fontSize: 12, color: "#8a8268", alignSelf: "center" }}>page {page + 1}</span>
            <button disabled={rows.length < PAGE} onClick={() => setPage((p) => p + 1)} style={{ fontSize: 12, border: "1px solid #cbb994", background: "#e3dac3", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
