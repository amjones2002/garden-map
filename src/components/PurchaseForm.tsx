"use client";
import { useState } from "react";
import type { Zone, Vendor, Purchase } from "@/lib/types";
import { PURCHASE_STATUSES } from "@/lib/purchases";
import { sortZonesByName } from "@/lib/zones";
import PlantField from "./PlantField";

const field: React.CSSProperties = {
  minHeight: 38,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #cbb994",
  width: "100%",
  boxSizing: "border-box",
};
const label: React.CSSProperties = { fontSize: 12, color: "#7a6a44", display: "block", marginBottom: 2 };

export default function PurchaseForm({
  zones,
  vendors,
  initial,
  defaultZoneSlug,
  onSaved,
  onCancel,
  onVendorAdded,
}: {
  zones: Zone[];
  vendors: Vendor[];
  initial?: Purchase | null;
  defaultZoneSlug?: string | null;
  onSaved: () => void;
  onCancel: () => void;
  onVendorAdded: (v: Vendor) => void;
}) {
  const defaultZoneId = defaultZoneSlug ? zones.find((z) => z.slug === defaultZoneSlug)?.id ?? "" : "";
  const zonesAlpha = sortZonesByName(zones);
  const [common, setCommon] = useState(initial?.common_name ?? "");
  const [botanical, setBotanical] = useState(initial?.botanical_name ?? "");
  const [catalogId, setCatalogId] = useState<string | null>(initial?.catalog_id ?? null);
  const [zoneId, setZoneId] = useState(initial?.zone_id ?? defaultZoneId);
  const [vendorId, setVendorId] = useState(initial?.vendor_id ?? "");
  const [date, setDate] = useState(initial?.purchase_date ?? "");
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : "");
  const [estimated, setEstimated] = useState(initial?.price_estimated ?? false);
  const [qty, setQty] = useState(initial?.quantity ?? 1);
  const [status, setStatus] = useState(initial?.status ?? "planted");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [newVendor, setNewVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addVendor() {
    const name = newVendor.trim();
    if (!name) return;
    const r = await fetch("/api/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      const v = (await r.json()) as Vendor;
      onVendorAdded(v);
      setVendorId(v.id);
      setNewVendor("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!common.trim()) {
      setErr("Plant name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload = {
      id: initial?.id,
      common_name: common.trim(),
      botanical_name: botanical.trim() || null,
      zone_id: zoneId || null,
      vendor_id: vendorId || null,
      purchase_date: date || null,
      price: price.trim() === "" ? null : Number(price.replace(/[$,]/g, "")),
      price_estimated: estimated,
      quantity: Number(qty) || 1,
      status,
      notes: notes.trim() || null,
      catalog_id: catalogId,
    };
    const r = await fetch("/api/purchases", {
      method: initial ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (r.ok) onSaved();
    else setErr((await r.json().catch(() => ({})))?.error ?? "Save failed");
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, padding: 12, border: "1px solid #cbb994", borderRadius: 12, background: "#fbf8ef" }}>
      <strong style={{ color: "#3f4a2e" }}>{initial ? "Edit purchase" : "Add purchase"}</strong>
      {err && <p style={{ color: "crimson", margin: 0 }}>{err}</p>}
      <div>
        <label style={label}>Plant name *</label>
        <PlantField
          commonName={common}
          botanicalName={botanical ?? ""}
          onChange={(v) => {
            setCommon(v.common_name);
            setBotanical(v.botanical_name);
            setCatalogId(v.catalog_id);
          }}
        />
      </div>
      <div>
        <label style={label}>Botanical name</label>
        <input style={field} value={botanical ?? ""} onChange={(e) => setBotanical(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Zone</label>
          <select style={field} value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">— unassigned —</option>
            {zonesAlpha.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>Vendor</label>
          <select style={field} value={vendorId ?? ""} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— none —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={field} placeholder="add a new vendor…" value={newVendor} onChange={(e) => setNewVendor(e.target.value)} />
        <button type="button" style={{ ...field, width: "auto", cursor: "pointer", background: "#e3dac3" }} onClick={addVendor}>
          + vendor
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Purchase date</label>
          <input type="date" style={field} value={date ?? ""} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>Price</label>
          <input style={field} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div style={{ width: 70 }}>
          <label style={label}>Qty</label>
          <input type="number" min={1} style={field} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
      </div>
      <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={estimated} onChange={(e) => setEstimated(e.target.checked)} /> price is an estimate
      </label>
      <div>
        <label style={label}>Status</label>
        <select style={field} value={status} onChange={(e) => setStatus(e.target.value as Purchase["status"])}>
          {PURCHASE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={label}>Notes</label>
        <textarea style={{ ...field, minHeight: 54 }} value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={{ ...field, width: "auto", cursor: "pointer", background: "#9bbf4a", fontWeight: 600 }}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} style={{ ...field, width: "auto", cursor: "pointer", background: "#e3dac3" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
