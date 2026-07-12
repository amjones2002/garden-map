import { normalizeBloomColor, CANONICAL_COLORS, type CanonicalColor } from "@/lib/photo-facets";

export type PhotoMetaProps = {
  caption: string | null;
  takenAt: string | null;
  zoneName: string | null;
  eraTitle?: string | null;
  quality?: "good" | "ok" | "poor" | null;
  bloomColors?: string[];
  reasoning?: string | null;
};

const swatch = (c: CanonicalColor) => CANONICAL_COLORS.find((x) => x.key === c)!;

export default function PhotoMeta(props: PhotoMetaProps) {
  const { caption, takenAt, zoneName, eraTitle, quality, bloomColors, reasoning } = props;

  const blooms = Array.from(
    new Set((bloomColors ?? []).map(normalizeBloomColor).filter((c): c is CanonicalColor => c !== null)),
  );
  const dateStr = takenAt ? new Date(takenAt).toLocaleDateString() : null;
  const facts = [dateStr, zoneName, eraTitle].filter(Boolean).join(" · ");

  return (
    <div style={{ padding: "12px 14px", color: "#3f4a2e" }}>
      {caption && <p style={{ fontSize: 14, lineHeight: 1.4, margin: "0 0 8px" }}>{caption}</p>}
      {(facts || quality) && (
        <p style={{ fontSize: 12, color: "#8a8268", margin: "0 0 10px" }}>
          {facts}
          {quality && (
            <span style={{ marginLeft: facts ? 8 : 0, background: "#dce8cf", color: "#4a5a2e", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
              {quality}
            </span>
          )}
        </p>
      )}
      {blooms.length > 0 && (
        <>
          <p style={{ fontSize: 9, letterSpacing: ".09em", color: "#8a8268", textTransform: "uppercase", margin: "10px 0 4px" }}>Blooming</p>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {blooms.map((c) => {
              const s = swatch(c);
              return (
                <span key={c} title={s.label} aria-label={s.label}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#5a5340" }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid #00000022", background: s.hex }} />
                  {s.label}
                </span>
              );
            })}
          </div>
        </>
      )}
      {reasoning && (
        <details style={{ marginTop: 10, borderTop: "1px dashed #cbb994", paddingTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "#8e3b5e", fontSize: 11 }}>AI Summary</summary>
          <p style={{ color: "#6a6350", fontSize: 11, margin: "6px 0 0", lineHeight: 1.4 }}>{reasoning}</p>
        </details>
      )}
    </div>
  );
}
