"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useEditMode } from "@/lib/edit-mode";
import type { Zone, Plant, Purchase } from "@/lib/types";

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
  const [newPlant, setNewPlant] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [p, pu] = await Promise.all([
      sb.from("plants").select("*").eq("zone_id", zone.id).order("sort_order"),
      sb.from("purchases").select("*").eq("zone_id", zone.id).order("created_at", { ascending: false }).limit(5),
    ]);
    setPlants((p.data ?? []) as Plant[]);
    setPurchases((pu.data ?? []) as Purchase[]);
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

        <h3 style={{ color: "#7a6a44", marginBottom: 4 }}>Currently planted</h3>
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
