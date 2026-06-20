export type Point = { x: number; y: number };

/** Average of points (centroid). Returns {0,0} for an empty array. */
export function centroid(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Convert normalized 0–1 points to an SVG `points` string scaled by `size`. */
export function toSvgPoints(points: Point[], size: number): string {
  return points.map((p) => `${p.x * size},${p.y * size}`).join(" ");
}
