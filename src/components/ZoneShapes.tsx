import { centroid, toSvgPoints } from "@/lib/geometry";
import type { Zone } from "@/lib/types";

const SIZE = 1000;

export default function ZoneShapes({
  zones,
  selectedId,
  onSelect,
}: {
  zones: Zone[];
  selectedId: string | null;
  onSelect: (zone: Zone) => void;
}) {
  return (
    <g>
      {zones.map((z) => {
        const pts = Array.isArray(z.shape) ? z.shape : [];
        if (pts.length < 3) return null;
        const selected = z.id === selectedId;
        const c = centroid(pts);
        return (
          <g
            key={z.id}
            role="button"
            tabIndex={0}
            aria-label={z.name}
            style={{ cursor: "pointer" }}
            onClick={() => onSelect(z)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(z);
            }}
          >
            <polygon
              points={toSvgPoints(pts, SIZE)}
              fill={z.fill_color ?? "#7aa329"}
              fillOpacity={selected ? 0.85 : 0.6}
              stroke={selected ? "#3f4a2e" : "#5e6b3a"}
              strokeWidth={selected ? 7 : 3}
            />
            <text
              x={c.x * SIZE}
              y={c.y * SIZE}
              fontSize={34}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#2f3722"
              style={{ pointerEvents: "none", fontFamily: "var(--font-hand), cursive" }}
            >
              {z.label ?? z.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
