"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Zone, MapLabel } from "@/lib/types";
import BaseMap from "./BaseMap";
import ZoneShapes from "./ZoneShapes";
import ZonePanel from "./ZonePanel";
import MapLabels from "./MapLabels";

export default function MapView() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [labels, setLabels] = useState<MapLabel[]>([]);
  const [selected, setSelected] = useState<Zone | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getBrowserSupabase();
    sb.from("zones")
      .select("*")
      .is("archived_at", null)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setZones((data ?? []) as Zone[]);
      });
    sb.from("map_labels")
      .select("*")
      .is("archived_at", null)
      .then(({ data }) => setLabels((data ?? []) as MapLabel[]));
  }, []);

  return (
    <div style={{ padding: 8 }}>
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      <svg
        viewBox="0 0 1000 1000"
        style={{ width: "100%", height: "auto", maxHeight: "calc(100vh - 150px)", touchAction: "manipulation", display: "block", margin: "0 auto" }}
        role="img"
        aria-label="Interactive yard map"
      >
        <BaseMap />
        <ZoneShapes zones={zones} selectedId={selected?.id ?? null} onSelect={setSelected} />
        <MapLabels labels={labels} />
      </svg>
      {selected && <ZonePanel zone={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
