import type { MapLabel } from "@/lib/types";

const SIZE = 1000;

/** Renders free-floating text labels (independent of zones) inside the map SVG. */
export default function MapLabels({ labels }: { labels: MapLabel[] }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {labels.map((l) => (
        <text
          key={l.id}
          x={l.x * SIZE}
          y={l.y * SIZE}
          fontSize={l.font_size}
          fill={l.color ?? "#3a3324"}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="var(--font-hand), cursive"
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}
