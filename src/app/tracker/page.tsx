"use client";
import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function TrackerPage() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .from("purchases")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => setCount(count ?? 0));
  }, []);

  return (
    <section style={{ padding: 16 }}>
      <h1>Purchase Tracker (placeholder)</h1>
      <p>{count === null ? "Loading…" : `${count} purchases logged`}</p>
    </section>
  );
}
