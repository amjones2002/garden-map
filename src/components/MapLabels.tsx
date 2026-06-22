import type { MapLabel } from "@/lib/types";

const SIZE = 1000;

/** Renders free-floating text labels (independent of zones) inside the map SVG. */
export default function MapLabels({ labels }: { labels: MapLabel[] }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {labels.map((l) => {
        const x = l.x * SIZE;
        const y = l.y * SIZE;
        return (
          <text
            key={l.id}
            x={x}
            y={y}
            transform={l.rotation ? `rotate(${l.rotation} ${x} ${y})` : undefined}
            fontSize={l.font_size}
            fill={l.color ?? "#3a3324"}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="var(--font-hand), cursive"
          >
            {l.text}
          </text>
        );
      })}
    </g>
  );
}
