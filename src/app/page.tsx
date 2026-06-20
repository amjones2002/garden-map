"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Zone } from "@/lib/types";

export default function MapPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .from("zones")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setZones((data ?? []) as Zone[]);
      });
  }, []);

  return (
    <section style={{ padding: 16 }}>
      <h1>Yard Map (placeholder)</h1>
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      <ul>
        {zones.map((z) => (
          <li key={z.id}>{z.name}</li>
        ))}
      </ul>
    </section>
  );
}
