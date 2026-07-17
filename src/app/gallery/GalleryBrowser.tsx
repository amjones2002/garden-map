"use client";
import { useMemo, useState } from "react";
import Image from "next/image";
import {
  type PhotoFacet, type Filters, EMPTY_FILTERS, matchesFilters, availableFacets,
  CANONICAL_COLORS, type CanonicalColor, type MilestoneKey,
} from "@/lib/photo-facets";
import { MILESTONES } from "@/lib/eras.mjs";
import { ERAS } from "@/lib/eras.data";
import { AREA_LABELS } from "@/lib/zones";
import { publicPhotoUrl } from "@/lib/photos";
import PhotoLightbox from "@/components/PhotoLightbox";
import { useEditMode } from "@/lib/edit-mode";
import type { Area } from "@/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      border: "1px solid " + (on ? "#8e3b5e" : "#cbb994"), borderRadius: 999, padding: "3px 10px",
      fontSize: 11, margin: "0 5px 5px 0", cursor: "pointer",
      background: on ? "#8e3b5e" : "#efe7d3", color: on ? "#fff" : "#5a5340",
    }}>{children}</button>
  );
}

export default function GalleryBrowser({ facets }: { facets: PhotoFacet[] }) {
  const { unlocked } = useEditMode();
  const [allFacets, setAllFacets] = useState<PhotoFacet[]>(facets);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [open, setOpen] = useState<PhotoFacet | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const available = useMemo(() => availableFacets(allFacets), [allFacets]);
  const shown = useMemo(() => allFacets.filter((f) => matchesFilters(f, filters)), [allFacets, filters]);

  const deletePhoto = async (id: string) => {
    const res = await fetch(`/api/zone-photos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    setAllFacets((prev) => prev.filter((f) => f.id !== id));
    setOpen(null);
  };

  // key is any array-valued Filters field; value toggles membership.
  const toggle = (key: Exclude<keyof Filters, "text">, value: string) =>
    setFilters((prev) => {
      const arr = prev[key] as string[];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: next } as Filters;
    });

  const eraLabel = (key: string) => ERAS.find((e) => e.key === key)?.title ?? key;
  const msLabel = (key: string) => MILESTONES.find((m) => m.key === key);
  const colorHex = (c: CanonicalColor) => CANONICAL_COLORS.find((x) => x.key === c)!;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const groupLabel: React.CSSProperties = { fontSize: 9, letterSpacing: ".09em", color: "#8a8268", textTransform: "uppercase", margin: "6px 6px 2px 0", display: "inline-block", width: 52 };

  return (
    <div style={{ padding: 12, paddingBottom: 72 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input
          placeholder="search plants, tags, captions…"
          value={filters.text}
          onChange={(e) => setFilters((p) => ({ ...p, text: e.target.value }))}
          style={{ flex: 1, height: 30, borderRadius: 8, border: "1px solid #cbb994", padding: "0 10px", fontSize: 12 }}
        />
        <span style={{ fontSize: 12, color: "#5a5340", whiteSpace: "nowrap" }}>
          {shown.length} photo{shown.length === 1 ? "" : "s"}
        </span>
        <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ fontSize: 11, color: "#8e3b5e", background: "none", border: "none", cursor: "pointer" }}>clear</button>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="gallery-filters-toggle"
          style={{ fontSize: 11, color: "#5a5340", background: "#efe7d3", border: "1px solid #cbb994", borderRadius: 8, padding: "4px 10px", cursor: "pointer", display: "none" }}
        >
          Filters{showFilters ? " ▲" : " ▼"}
        </button>
      </div>

      <style>{`
        .gallery-filters-toggle { display: none; }
        .gallery-facets { display: block; }
        @media (max-width: 719px) {
          .gallery-filters-toggle { display: inline-block !important; }
          .gallery-facets { display: none; }
          .gallery-facets.gallery-facets-open { display: block; }
        }
      `}</style>

      <div className={"gallery-facets" + (showFilters ? " gallery-facets-open" : "")}>
        <div data-testid="facet-area" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Area</span>
          {available.areas.map(({ value, count }) => (
            <Chip key={value} on={filters.areas.includes(value)} onClick={() => toggle("areas", value)}>
              {AREA_LABELS[value as Area]} · {count}
            </Chip>
          ))}
        </div>
        {available.zones.length > 0 && (
          <div data-testid="facet-zone" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
            <span style={groupLabel}>Zone</span>
            {available.zones.map(({ value, label, count }) => (
              <Chip key={value} on={filters.zoneIds.includes(value)} onClick={() => toggle("zoneIds", value)}>
                {label} · {count}
              </Chip>
            ))}
          </div>
        )}
        {ERAS.length > 0 && available.eras.length > 0 && (
          <div data-testid="facet-era" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
            <span style={groupLabel}>Era</span>
            {available.eras.map(({ value, count }) => (
              <Chip key={value} on={filters.eraKeys.includes(value)} onClick={() => toggle("eraKeys", value)}>
                {eraLabel(value)} · {count}
              </Chip>
            ))}
          </div>
        )}
        <div data-testid="facet-season" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Season</span>
          {available.seasonYears.map(({ value, label, count }) => (
            <Chip key={value} on={filters.seasonYears.includes(value)} onClick={() => toggle("seasonYears", value)}>
              {label} · {count}
            </Chip>
          ))}
        </div>
        <div data-testid="facet-milestone" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Built</span>
          {available.milestones.map(({ value, count }) => (
            <Chip key={value} on={filters.milestones.includes(value as MilestoneKey)} onClick={() => toggle("milestones", value)}>
              {msLabel(value)?.icon} {msLabel(value)?.label} · {count}
            </Chip>
          ))}
        </div>
        <div data-testid="facet-bloom" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Bloom</span>
          {available.bloom.map(({ value, count }) => (
            <Chip key={value} on={filters.bloom.includes(value)} onClick={() => toggle("bloom", value)}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: colorHex(value).hex, marginRight: 4, verticalAlign: -1 }} />
              {colorHex(value).label} · {count}
            </Chip>
          ))}
        </div>
        <div data-testid="facet-quality" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
          <span style={groupLabel}>Quality</span>
          {available.quality.map(({ value, count }) => (
            <Chip key={value} on={filters.quality.includes(value)} onClick={() => toggle("quality", value)}>
              {cap(value)} · {count}
            </Chip>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6, marginTop: 8 }}>
        {shown.map((f) => (
          <button key={f.id} onClick={() => setOpen(f)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
            <Image
              src={publicPhotoUrl(SUPABASE_URL, f.storagePath)}
              alt={f.caption ?? "yard photo"} width={220} height={165} loading="lazy"
              style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, border: "1px solid #cbb994", display: "block" }}
            />
          </button>
        ))}
      </div>

      {open && (
        <PhotoLightbox
          src={publicPhotoUrl(SUPABASE_URL, open.storagePath)}
          alt={open.caption ?? "yard photo"}
          onClose={() => setOpen(null)}
          onDelete={unlocked ? () => deletePhoto(open.id) : undefined}
          meta={{
            caption: open.caption, takenAt: open.takenAt, zoneName: open.zoneName,
            eraTitle: open.eraKey ? eraLabel(open.eraKey) : null,
            quality: open.quality, bloomColors: open.bloomColors, reasoning: open.reasoning,
          }}
        />
      )}
    </div>
  );
}
