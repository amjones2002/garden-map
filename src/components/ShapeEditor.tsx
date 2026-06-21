"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { centroid, normalizeShape, toSvgPoints, type Point } from "@/lib/geometry";
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
  const [showOthers, setShowOthers] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#7aa329");
  const [msg, setMsg] = useState<string | null>(null);
  const movedRef = useRef(false);

  const loadZones = useCallback(async () => {
    let q = getBrowserSupabase().from("zones").select("*").order("sort_order");
    if (!showArchived) q = q.is("archived_at", null);
    const { data } = await q;
    setZones((data ?? []) as Zone[]);
  }, [showArchived]);

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
    setEditName(z?.label ?? z?.name ?? "");
    setEditColor(z?.fill_color ?? "#7aa329");
  }

  async function newZone() {
    const name = prompt("New zone name?")?.trim();
    if (!name) return;
    const r = await fetch("/api/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      setMsg("Could not create zone.");
      return;
    }
    const z = (await r.json()) as Zone;
    await loadZones();
    setSelectedId(z.id);
    setPoints([]);
    setEditName(z.label ?? z.name);
    setEditColor(z.fill_color ?? "#7aa329");
    setMsg(`Created “${z.name}”. Tap the map to draw its shape, then Save.`);
  }

  async function toggleArchive() {
    const z = zones.find((x) => x.id === selectedId);
    if (!z) return;
    const archiving = !z.archived_at;
    if (archiving && !confirm(`Archive “${z.name}”? It will be hidden from the public map; data is kept and can be restored.`)) return;
    await fetch("/api/zones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: z.id, archived: archiving }),
    });
    await loadZones();
    setSelectedId("");
    setPoints([]);
    setMsg(archiving ? "Zone archived." : "Zone restored.");
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
      body: JSON.stringify({
        id: selectedId,
        shape,
        name: editName.trim() || undefined,
        label: editName.trim() || undefined,
        fill_color: editColor,
      }),
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
            <option key={z.id} value={z.id}>
              {z.name}
              {z.archived_at ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <button style={{ ...ctrl, background: "#e3dac3" }} onClick={newZone}>+ New zone</button>
        <label style={{ ...ctrl, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived
        </label>
      </div>

      {selectedZone && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input
            style={{ ...ctrl, cursor: "text" }}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="zone name"
            aria-label="zone name"
          />
          <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} aria-label="zone color" style={{ width: 44, height: 38, border: "1px solid #cbb994", borderRadius: 8, background: "#f5efe0" }} />
          <button style={{ ...ctrl, color: "#8e3b5e" }} onClick={toggleArchive}>
            {selectedZone.archived_at ? "Restore" : "Archive"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <button style={ctrl} onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length}>Undo point</button>
        <button style={ctrl} onClick={removeSelected} disabled={selectedPoint === null}>Delete point</button>
        <button style={ctrl} onClick={() => selectedId && selectZone(selectedId)} disabled={!selectedId}>Reset</button>
        <button style={{ ...ctrl, background: "#9bbf4a", fontWeight: 600 }} onClick={save} disabled={!selectedId}>Save</button>
        <label style={{ ...ctrl, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} /> show other zones
        </label>
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

        {/* Dim the base map while editing so zones stand out */}
        {selectedId && <rect x="0" y="0" width="1000" height="1000" fill="#f3ead4" opacity={0.3} style={{ pointerEvents: "none" }} />}

        {/* Other zones (context): solid, subdued, and labeled so you can tell them apart */}
        {showOthers &&
          zones
            .filter((z) => z.id !== selectedId && Array.isArray(z.shape) && z.shape.length >= 3)
            .map((z) => {
              const c = centroid(z.shape as Point[]);
              return (
                <g key={z.id} style={{ pointerEvents: "none" }}>
                  <polygon
                    points={toSvgPoints(z.shape as Point[], SIZE)}
                    fill={z.fill_color ?? "#999"}
                    fillOpacity={0.22}
                    stroke={z.fill_color ?? "#9c8567"}
                    strokeOpacity={0.55}
                    strokeWidth={2}
                  />
                  <text
                    x={c.x * SIZE}
                    y={c.y * SIZE}
                    fontSize={19}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#6b5f44"
                    fillOpacity={0.75}
                    fontFamily="var(--font-hand), cursive"
                  >
                    {z.label ?? z.name}
                  </text>
                </g>
              );
            })}

        {/* Editing polygon (bold) + its label */}
        {points.length >= 2 && (
          <polygon
            points={toSvgPoints(points, SIZE)}
            fill={selectedZone?.fill_color ?? "#9bbf4a"}
            fillOpacity={0.5}
            stroke="#3f4a2e"
            strokeWidth={5}
            style={{ pointerEvents: "none" }}
          />
        )}
        {points.length >= 3 && selectedZone && (
          <text
            x={centroid(points).x}
            y={centroid(points).y}
            fontSize={26}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#2f3722"
            fontFamily="var(--font-hand), cursive"
            style={{ pointerEvents: "none" }}
          >
            {selectedZone.label ?? selectedZone.name}
          </text>
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={selectedPoint === i ? 16 : 12}
            fill={selectedPoint === i ? "#8e3b5e" : i === 0 ? "#9bbf4a" : "#fff"}
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
