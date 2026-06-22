"use client";
import { useEffect, useRef, useState } from "react";
import type { CatalogResult } from "@/lib/plant-catalog";

const field: React.CSSProperties = {
  minHeight: 38,
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #cbb994",
  width: "100%",
  boxSizing: "border-box",
};

export default function PlantField({
  commonName,
  botanicalName,
  onChange,
}: {
  commonName: string;
  botanicalName: string;
  onChange: (v: { common_name: string; botanical_name: string; catalog_id: string | null }) => void;
}) {
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = commonName.trim();
    debounce.current = setTimeout(async () => {
      if (!open || q.length < 2) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/plant-catalog?q=${encodeURIComponent(q)}`);
        if (res.ok) setResults(((await res.json()).results ?? []) as CatalogResult[]);
        else setResults([]);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [commonName, open]);

  function pick(r: CatalogResult) {
    onChange({
      common_name: r.common_name ?? r.scientific_name,
      botanical_name: r.scientific_name,
      catalog_id: r.id,
    });
    setResults([]);
    setOpen(false);
  }

  function useCustom() {
    onChange({ common_name: commonName.trim(), botanical_name: botanicalName, catalog_id: null });
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        style={field}
        value={commonName}
        placeholder="search the catalog…"
        aria-label="plant name (search catalog)"
        onChange={(e) => {
          setOpen(true);
          onChange({ common_name: e.target.value, botanical_name: botanicalName, catalog_id: null });
        }}
        onFocus={() => setOpen(true)}
        required
      />
      {open && results.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "2px 0 0",
            padding: 4,
            border: "1px solid #cbb994",
            borderRadius: 8,
            background: "#fff",
            maxHeight: 200,
            overflowY: "auto",
            position: "absolute",
            zIndex: 80,
            width: "100%",
          }}
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pick(r)}
                style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "6px 8px", cursor: "pointer" }}
              >
                <strong>{r.common_name ?? r.scientific_name}</strong>
                {r.common_name && <em style={{ color: "#8a8268" }}> — {r.scientific_name}</em>}
              </button>
            </li>
          ))}
          {commonName.trim().length >= 2 && (
            <li>
              <button
                type="button"
                onClick={useCustom}
                style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "6px 8px", cursor: "pointer", color: "#7a6a44" }}
              >
                {`Use "${commonName.trim()}" as a custom plant`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
