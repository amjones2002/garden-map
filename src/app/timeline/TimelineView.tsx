"use client";
import { useMemo, useState } from "react";
import Image from "next/image";
import type { EraContent } from "@/lib/eras.data";
import { MILESTONES } from "@/lib/eras.mjs";
import { publicPhotoUrl } from "@/lib/photos";
import PhotoLightbox from "@/components/PhotoLightbox";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

type TimelinePhoto = {
  id: string; storagePath: string; caption: string | null; takenAt: string | null;
  zoneName: string | null; quality: "good" | "ok" | "poor" | null; bloomColors: string[]; reasoning: string | null;
};
type Season = { key: string; label: string; photos: TimelinePhoto[] };
export type TimelineEra = EraContent & { seasons: Season[] };

export default function TimelineView({ eras }: { eras: TimelineEra[] }) {
  const [open, setOpen] = useState<{ era: TimelineEra; p: TimelinePhoto } | null>(null);

  // Flat, ordered list of every photo (with its era) so the lightbox can step
  // across season and era boundaries.
  const flat = useMemo(
    () => eras.flatMap((era) => era.seasons.flatMap((s) => s.photos.map((p) => ({ era, p })))),
    [eras],
  );

  if (eras.length === 0) {
    return <p style={{ padding: 24, color: "#8a8268" }}>The timeline hasn’t been generated yet. Run <code>npm run gen:eras</code>.</p>;
  }

  return (
    <div style={{ display: "flex", gap: 12, padding: 12, paddingBottom: 72 }}>
      <nav style={{ position: "sticky", top: 12, alignSelf: "flex-start", flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 4, maxWidth: 130 }}>
        {eras.map((e) => (
          <a key={e.key} href={`#${e.key}`} style={{ fontSize: 12, color: "#5a5340", textDecoration: "none", padding: "5px 8px", borderRadius: 6, background: "#efe7d3", border: "1px solid #cbb994" }}>
            {e.title}
          </a>
        ))}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        {eras.map((e) => (
          <section key={e.key} id={e.key} style={{ marginBottom: 28, scrollMarginTop: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: ".08em", color: "#8a8268" }}>
              {e.start.slice(0, 10)} → {e.end ? e.end.slice(0, 10) : "present"}
            </div>
            <h2 style={{ margin: "2px 0 4px", color: "#3f4a2e" }}>{e.title}</h2>
            {e.milestones.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {e.milestones.map((k) => {
                  const m = MILESTONES.find((x) => x.key === k);
                  return <span key={k} style={{ fontSize: 11, background: "#e3dac3", border: "1px solid #cbb994", borderRadius: 999, padding: "1px 8px", marginRight: 4 }}>{m?.icon} {m?.label}</span>;
                })}
              </div>
            )}
            {e.blurb && <p style={{ color: "#5a5340", fontStyle: "italic", margin: "0 0 10px" }}>{e.blurb}</p>}

            {e.seasons.map((s) => (
              <div key={s.key} style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#8e3b5e", margin: "0 0 4px", fontWeight: 600 }}>{s.label} · {s.photos.length}</p>
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                  {s.photos.map((p) => (
                    <button key={p.id} onClick={() => setOpen({ era: e, p })} style={{ flex: "0 0 auto", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                      <Image src={publicPhotoUrl(SUPABASE_URL, p.storagePath)} alt={p.caption ?? "yard photo"} width={120} height={90} loading="lazy"
                        style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #cbb994", display: "block" }} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      {open && (() => {
        const idx = flat.findIndex((x) => x.p.id === open.p.id);
        return (
        <PhotoLightbox
          src={publicPhotoUrl(SUPABASE_URL, open.p.storagePath)}
          alt={open.p.caption ?? "yard photo"}
          onClose={() => setOpen(null)}
          onPrev={idx > 0 ? () => setOpen(flat[idx - 1]) : undefined}
          onNext={idx >= 0 && idx < flat.length - 1 ? () => setOpen(flat[idx + 1]) : undefined}
          meta={{ caption: open.p.caption, takenAt: open.p.takenAt, zoneName: open.p.zoneName, eraTitle: open.era.title, quality: open.p.quality, bloomColors: open.p.bloomColors, reasoning: open.p.reasoning }}
        />
        );
      })()}
    </div>
  );
}
