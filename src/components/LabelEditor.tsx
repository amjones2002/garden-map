"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { centroid, toSvgPoints, type Point } from "@/lib/geometry";
import type { MapLabel, Zone } from "@/lib/types";
import BaseMap from "./BaseMap";

const SIZE = 1000;
const ctrl: React.CSSProperties = { minHeight: 38, padding: "6px 10px", borderRadius: 8, border: "1px solid #cbb994", background: "#f5efe0", cursor: "pointer" };

export default function LabelEditor() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [labels, setLabels] = useState<MapLabel[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editColor, setEditColor] = useState("#3a3324");
  const [editRotation, setEditRotation] = useState(0);
  const [editFontSize, setEditFontSize] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const movedRef = useRef(false);

  const load = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [l, z] = await Promise.all([
      sb.from("map_labels").select("*").is("archived_at", null),
      sb.from("zones").select("*").order("sort_order"),
    ]);
    setLabels((l.data ?? []) as MapLabel[]);
    setZones((z.data ?? []) as Zone[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function svgPoint(e: React.PointerEvent): Point {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x / SIZE, y: p.y / SIZE };
  }

  async function addLabelAt(e: React.PointerEvent) {
    const text = prompt("Label text?")?.trim();
    if (!text) return;
    const p = svgPoint(e);
    const r = await fetch("/api/map-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, x: p.x, y: p.y }),
    });
    if (r.ok) {
      const l = (await r.json()) as MapLabel;
      await load();
      setSelectedId(l.id);
      setEditText(l.text);
    }
  }

  function onLabelDown(e: React.PointerEvent, l: MapLabel) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragId(l.id);
    setSelectedId(l.id);
    setEditText(l.text);
    setEditColor(l.color ?? "#3a3324");
    setEditRotation(l.rotation ?? 0);
    setEditFontSize(l.font_size);
    movedRef.current = false;
  }

  function onMove(e: React.PointerEvent) {
    if (!dragId) return;
    movedRef.current = true;
    const p = svgPoint(e);
    setLabels((ls) => ls.map((l) => (l.id === dragId ? { ...l, x: p.x, y: p.y } : l)));
  }

  async function onUp() {
    if (dragId && movedRef.current) {
      const l = labels.find((x) => x.id === dragId);
      if (l) {
        await fetch("/api/map-labels", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: l.id, x: l.x, y: l.y }),
        });
      }
    }
    setDragId(null);
  }

  async function saveSelected() {
    if (!selectedId) return;
    await fetch("/api/map-labels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedId,
        text: editText.trim() || undefined,
        color: editColor,
        rotation: editRotation,
        font_size: editFontSize,
      }),
    });
    setMsg("Saved.");
    load();
  }

  async function del(id: string) {
    if (!confirm("Delete this label?")) return;
    await fetch(`/api/map-labels?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setSelectedId(null);
    load();
  }

  const selected = labels.find((l) => l.id === selectedId);

  return (
    <section style={{ padding: 12 }}>
      <h1 style={{ color: "#3f4a2e", marginTop: 0 }}>Text Labels</h1>
      <p style={{ color: "#7a6a44", marginTop: 0 }}>
        Tap an empty spot to add a label, drag a label to move it, tap a label to edit or delete it.{" "}
        <Link href="/editor" style={{ color: "#8e3b5e" }}>← back to zone shapes</Link>
      </p>

      {selected && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input style={{ ...ctrl, cursor: "text" }} value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="label text" aria-label="label text" />
          <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} aria-label="label color" style={{ width: 44, height: 38, border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0" }} />
          <input type="number" value={editRotation} onChange={(e) => setEditRotation(Number(e.target.value))} aria-label="label rotation degrees" title="rotation (degrees)" style={{ ...ctrl, cursor: "text", width: 90 }} />
          <input type="number" value={editFontSize} onChange={(e) => setEditFontSize(Number(e.target.value))} aria-label="label font size" title="font size" style={{ ...ctrl, cursor: "text", width: 90 }} />
          <button style={{ ...ctrl, background: "#9bbf4a", fontWeight: 600 }} onClick={saveSelected}>Save text</button>
          <button style={{ ...ctrl, color: "#8e3b5e" }} onClick={() => del(selected.id)}>Delete</button>
        </div>
      )}
      {msg && <p style={{ color: "#7a6a44" }}>{msg}</p>}

      <svg
        ref={svgRef}
        viewBox="0 0 1000 1000"
        style={{ width: "100%", height: "auto", maxHeight: "70vh", display: "block", touchAction: "none", border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0" }}
        onPointerDown={addLabelAt}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <BaseMap />

        {/* Faint zone context */}
        {zones
          .filter((z) => Array.isArray(z.shape) && z.shape.length >= 3)
          .map((z) => {
            const c = centroid(z.shape as Point[]);
            return (
              <g key={z.id} style={{ pointerEvents: "none" }}>
                <polygon points={toSvgPoints(z.shape as Point[], SIZE)} fill={z.fill_color ?? "#999"} fillOpacity={0.15} stroke="#9c8567" strokeOpacity={0.4} strokeWidth={1.5} />
                <text x={c.x * SIZE} y={c.y * SIZE} fontSize={16} textAnchor="middle" dominantBaseline="middle" fill="#9c8567" fontFamily="var(--font-hand), cursive">
                  {z.label ?? z.name}
                </text>
              </g>
            );
          })}

        {/* Editable labels */}
        {labels.map((l) => (
          <g key={l.id} style={{ cursor: "grab" }} onPointerDown={(e) => onLabelDown(e, l)}>
            <text
              x={l.x * SIZE}
              y={l.y * SIZE}
              transform={l.rotation ? `rotate(${l.rotation} ${l.x * SIZE} ${l.y * SIZE})` : undefined}
              fontSize={l.font_size}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={l.color ?? "#3a3324"}
              fontFamily="var(--font-hand), cursive"
              stroke={selectedId === l.id ? "#8e3b5e" : "none"}
              strokeWidth={selectedId === l.id ? 0.6 : 0}
            >
              {l.text}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}
