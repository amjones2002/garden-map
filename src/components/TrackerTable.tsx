"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useEditMode } from "@/lib/edit-mode";
import type { Zone, Vendor, Purchase } from "@/lib/types";
import { PURCHASE_STATUSES, filterPurchases, sortPurchases, toCsv } from "@/lib/purchases";
import PurchaseForm from "./PurchaseForm";

const ctrl: React.CSSProperties = { minHeight: 36, padding: "4px 8px", borderRadius: 8, border: "1px solid #cbb994" };

export default function TrackerTable() {
  const { unlocked } = useEditMode();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [filters, setFilters] = useState<{ zoneId: string; status: string; vendorId: string; search: string }>({
    zoneId: "",
    status: "",
    vendorId: "",
    search: "",
  });
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "purchase_date", dir: "desc" });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [defaultZone, setDefaultZone] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [p, z, v] = await Promise.all([
      sb.from("purchases").select("*").order("created_at", { ascending: false }),
      sb.from("zones").select("*").order("sort_order"),
      sb.from("vendors").select("*").order("name"),
    ]);
    setPurchases((p.data ?? []) as Purchase[]);
    setZones((z.data ?? []) as Zone[]);
    setVendors((v.data ?? []) as Vendor[]);
  }, []);

  useEffect(() => {
    load();
    const zoneParam = new URLSearchParams(window.location.search).get("zone");
    if (zoneParam) {
      setDefaultZone(zoneParam);
      setShowForm(true);
    }
  }, [load]);

  const zoneNames = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z.name])), [zones]);
  const vendorNames = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);

  const visible = useMemo(
    () => sortPurchases(filterPurchases(purchases, filters), sort.key, sort.dir),
    [purchases, filters, sort],
  );

  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function exportCsv() {
    const csv = toCsv(visible, zoneNames, vendorNames);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "garden-purchases.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    setImportMsg("Reading…");
    const text = await file.text();
    const dry = await fetch("/api/purchases/import?dryRun=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text }),
    });
    if (!dry.ok) {
      setImportMsg(`Import error: ${(await dry.json().catch(() => ({})))?.error ?? dry.status}`);
      return;
    }
    const preview = await dry.json();
    if (!confirm(`Import ${preview.willInsert} rows (${preview.skipped} skipped)?`)) {
      setImportMsg(null);
      return;
    }
    const res = await fetch("/api/purchases/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text }),
    });
    const out = await res.json();
    setImportMsg(res.ok ? `Imported ${out.inserted} rows.` : `Error: ${out.error}`);
    load();
  }

  async function del(id: string) {
    if (!confirm("Delete this purchase?")) return;
    await fetch(`/api/purchases?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }

  const headers: [string, string][] = [
    ["common_name", "Plant"],
    ["zone_id", "Zone"],
    ["vendor_id", "Vendor"],
    ["purchase_date", "Date"],
    ["price", "Price"],
    ["quantity", "Qty"],
    ["status", "Status"],
  ];

  return (
    <section style={{ padding: 12 }}>
      <h1 style={{ color: "#3f4a2e", marginTop: 0 }}>Purchase Tracker</h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <input style={ctrl} placeholder="search plant…" value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        <select style={ctrl} value={filters.zoneId} onChange={(e) => setFilters((f) => ({ ...f, zoneId: e.target.value }))}>
          <option value="">all zones</option>
          {zones.map((z) => (<option key={z.id} value={z.id}>{z.name}</option>))}
        </select>
        <select style={ctrl} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">all statuses</option>
          {PURCHASE_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select style={ctrl} value={filters.vendorId} onChange={(e) => setFilters((f) => ({ ...f, vendorId: e.target.value }))}>
          <option value="">all vendors</option>
          {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
        </select>
        <button style={{ ...ctrl, cursor: "pointer", background: "#e3dac3" }} onClick={exportCsv}>Export CSV</button>
        {unlocked && (
          <>
            <button style={{ ...ctrl, cursor: "pointer", background: "#9bbf4a" }} onClick={() => { setEditing(null); setDefaultZone(null); setShowForm(true); }}>
              + Add purchase
            </button>
            <label style={{ ...ctrl, cursor: "pointer", background: "#e3dac3" }}>
              Import CSV
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
            </label>
          </>
        )}
      </div>
      {importMsg && <p style={{ color: "#7a6a44" }}>{importMsg}</p>}

      {showForm && unlocked && (
        <div style={{ marginBottom: 12 }}>
          <PurchaseForm
            zones={zones}
            vendors={vendors}
            initial={editing}
            defaultZoneSlug={defaultZone}
            onSaved={() => { setShowForm(false); setEditing(null); load(); }}
            onCancel={() => { setShowForm(false); setEditing(null); }}
            onVendorAdded={(v) => setVendors((vs) => [...vs, v].sort((a, b) => a.name.localeCompare(b.name)))}
          />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr>
              {headers.map(([key, lbl]) => (
                <th key={key} onClick={() => toggleSort(key)} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #cbb994", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {lbl}{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              {unlocked && <th style={{ padding: "6px 8px", borderBottom: "2px solid #cbb994" }} />}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #e3dac3" }}>
                <td style={{ padding: "6px 8px" }}>
                  {p.common_name}
                  {p.botanical_name ? <em style={{ color: "#8a8268" }}> · {p.botanical_name}</em> : null}
                </td>
                <td style={{ padding: "6px 8px" }}>{p.zone_id ? zoneNames[p.zone_id] : "—"}</td>
                <td style={{ padding: "6px 8px" }}>{p.vendor_id ? vendorNames[p.vendor_id] : "—"}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{p.purchase_date ?? "—"}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{p.price == null ? "—" : `${p.price_estimated ? "~" : ""}$${p.price}`}</td>
                <td style={{ padding: "6px 8px" }}>{p.quantity}</td>
                <td style={{ padding: "6px 8px" }}>{p.status}</td>
                {unlocked && (
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                    <button style={{ border: "none", background: "transparent", color: "#3f4a2e", cursor: "pointer" }} onClick={() => { setEditing(p); setShowForm(true); }}>edit</button>
                    <button style={{ border: "none", background: "transparent", color: "#8e3b5e", cursor: "pointer" }} onClick={() => del(p.id)}>delete</button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={headers.length + (unlocked ? 1 : 0)} style={{ padding: 16, color: "#8a8268" }}>No purchases match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
