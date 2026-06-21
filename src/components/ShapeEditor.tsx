"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { normalizeShape, toSvgPoints, type Point } from "@/lib/geometry";
import type { Zone } from "@/lib/types";
import BaseMap from "./BaseMap";

const SIZE = 1000;
const ctrl: React.CSSProperties = { minHeight: 38, padding: "6px 10px", borderRadius: 8, border: "1px solid #cbb994", background: "#f5efe0", cursor: "pointer" };

export default function ShapeEditor() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [points, setPoints] = useState<Point[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const movedRef = useRef(false);

  const loadZones = useCallback(async () => {
    const { data } = await getBrowserSupabase().from("zones").select("*").order("sort_order");
    setZones((data ?? []) as Zone[]);
  }, []);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  function selectZone(id: string) {
    setSelectedId(id);
    setSelectedPoint(null);
    setMsg(null);
    const z = zones.find((x) => x.id === id);
    const shape = (z?.shape ?? []) as Point[];
    setPoints(shape.map((p) => ({ x: p.x * SIZE, y: p.y * SIZE })));
  }

  function svgPoint(e: React.PointerEvent): Point {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function addPointAt(e: React.PointerEvent) {
    if (!selectedId) {
      setMsg("Pick a zone to edit first.");
      return;
    }
    const p = svgPoint(e);
    setPoints((pts) => [...pts, p]);
    setSelectedPoint(points.length);
  }

  function onHandleDown(e: React.PointerEvent, i: number) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragIndex(i);
    setSelectedPoint(i);
    movedRef.current = false;
  }

  function onMove(e: React.PointerEvent) {
    if (dragIndex === null) return;
    movedRef.current = true;
    const p = svgPoint(e);
    setPoints((pts) => pts.map((old, idx) => (idx === dragIndex ? p : old)));
  }

  function onUp() {
    setDragIndex(null);
  }

  function removeSelected() {
    if (selectedPoint === null) return;
    setPoints((pts) => pts.filter((_, i) => i !== selectedPoint));
    setSelectedPoint(null);
  }

  async function save() {
    if (!selectedId) return;
    setMsg("Saving…");
    const shape = normalizeShape(points, SIZE);
    const r = await fetch("/api/zones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId, shape }),
    });
    if (r.ok) {
      setMsg("Saved — the live map now uses this shape.");
      loadZones();
    } else {
      setMsg(`Error: ${(await r.json().catch(() => ({})))?.error ?? r.status}`);
    }
  }

  const selectedZone = zones.find((z) => z.id === selectedId);

  return (
    <section style={{ padding: 12 }}>
      <h1 style={{ color: "#3f4a2e", marginTop: 0 }}>Zone Shape Editor</h1>
      <p style={{ color: "#7a6a44", marginTop: 0 }}>
        Pick a zone, tap to add points, drag handles to adjust. Tap a handle then “Delete point” to remove it.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <select style={ctrl} value={selectedId} onChange={(e) => selectZone(e.target.value)}>
          <option value="">— choose a zone —</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </select>
        <button style={ctrl} onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length}>Undo point</button>
        <button style={ctrl} onClick={removeSelected} disabled={selectedPoint === null}>Delete point</button>
        <button style={ctrl} onClick={() => selectedId && selectZone(selectedId)} disabled={!selectedId}>Reset</button>
        <button style={{ ...ctrl, background: "#9bbf4a", fontWeight: 600 }} onClick={save} disabled={!selectedId}>Save</button>
      </div>
      {msg && <p style={{ color: "#7a6a44" }}>{msg}</p>}

      <svg
        ref={svgRef}
        viewBox="0 0 1000 1000"
        style={{ width: "100%", height: "auto", maxHeight: "70vh", display: "block", touchAction: "none", border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0" }}
        onPointerDown={addPointAt}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <BaseMap />

        {/* Other zones for context */}
        {zones
          .filter((z) => z.id !== selectedId && Array.isArray(z.shape) && z.shape.length >= 3)
          .map((z) => (
            <polygon key={z.id} points={toSvgPoints(z.shape as Point[], SIZE)} fill={z.fill_color ?? "#999"} fillOpacity={0.15} stroke="#9c8567" strokeWidth={2} strokeDasharray="6 6" style={{ pointerEvents: "none" }} />
          ))}

        {/* Editing polygon */}
        {points.length >= 2 && (
          <polygon points={toSvgPoints(points, SIZE)} fill={selectedZone?.fill_color ?? "#9bbf4a"} fillOpacity={0.4} stroke="#3f4a2e" strokeWidth={4} style={{ pointerEvents: "none" }} />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={selectedPoint === i ? 16 : 12}
            fill={selectedPoint === i ? "#8e3b5e" : "#fff"}
            stroke="#3f4a2e"
            strokeWidth={3}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => onHandleDown(e, i)}
          />
        ))}
      </svg>
    </section>
  );
}
