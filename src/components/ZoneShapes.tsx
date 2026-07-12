import { visualCenter, fitLabel, toSvgPoints } from "@/lib/geometry";
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
        const c = visualCenter(pts);
        const cx = c.x * SIZE;
        const cy = c.y * SIZE;

        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const boxWidth = (Math.max(...xs) - Math.min(...xs)) * SIZE;
        const boxHeight = (Math.max(...ys) - Math.min(...ys)) * SIZE;
        const { lines, fontSize } = fitLabel(z.label ?? z.name, boxWidth, boxHeight);
        const linePx = fontSize * 1.15;
        const startY = cy - ((lines.length - 1) / 2) * linePx;

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
              x={cx}
              y={startY}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#2f3722"
              style={{ pointerEvents: "none", fontFamily: "var(--font-hand), cursive" }}
            >
              {lines.map((line, i) => (
                <tspan key={i} x={cx} y={startY + i * linePx}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </g>
  );
}
