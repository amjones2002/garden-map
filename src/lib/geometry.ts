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

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Convert SVG-space points (0..size) to normalized, rounded (4dp), clamped [0,1] points. */
export function normalizeShape(points: Point[], size: number): Point[] {
  return points.map((p) => ({
    x: round4(clamp01(p.x / size)),
    y: round4(clamp01(p.y / size)),
  }));
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function distanceToEdges(p: Point, poly: Point[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    min = Math.min(min, distToSegment(p, poly[j], poly[i]));
  }
  return min;
}

/**
 * "Pole of inaccessibility": the interior point furthest from any edge — a
 * robust label anchor that stays inside concave (e.g. L-shaped) polygons.
 * Falls back to `centroid` for degenerate input.
 */
export function visualCenter(points: Point[]): Point {
  if (points.length < 3) return centroid(points);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX - minX === 0 || maxY - minY === 0) return centroid(points);

  let best = centroid(points);
  let bestDist = pointInPolygon(best, points) ? distanceToEdges(best, points) : -1;

  const GRID = 8;
  let cx = minX, cy = minY, cw = maxX - minX, ch = maxY - minY;
  for (let iter = 0; iter < 6; iter++) {
    const stepX = cw / GRID, stepY = ch / GRID;
    for (let i = 0; i <= GRID; i++) {
      for (let j = 0; j <= GRID; j++) {
        const p = { x: cx + i * stepX, y: cy + j * stepY };
        if (!pointInPolygon(p, points)) continue;
        const d = distanceToEdges(p, points);
        if (d > bestDist) { bestDist = d; best = p; }
      }
    }
    // Zoom the search window into the neighbourhood of the current best.
    cw = (cw / GRID) * 2;
    ch = (ch / GRID) * 2;
    cx = best.x - cw / 2;
    cy = best.y - ch / 2;
  }
  return best;
}

const LABEL_CAP = 34;      // max font size (SVG units)
const LABEL_FLOOR = 13;    // min legible font size
const LABEL_FILL = 0.9;    // fraction of the box the text may occupy
const CHAR_W = 0.5;        // avg glyph width as a fraction of font size (hand font)
const LINE_HEIGHT = 1.15;  // line advance as a multiple of font size

/** Split words into two lines with the most even character counts. */
function balancedSplit(words: string[]): [string, string] {
  let bestIdx = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    const diff = Math.abs(left.length - right.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return [words.slice(0, bestIdx).join(" "), words.slice(bestIdx).join(" ")];
}

/**
 * Fit `text` inside a `boxWidth` x `boxHeight` box (SVG units): try one line,
 * then two balanced lines, and pick whichever allows the largest font.
 * Font is capped at LABEL_CAP and floored at LABEL_FLOOR; lines are never empty.
 */
export function fitLabel(
  text: string,
  boxWidth: number,
  boxHeight: number,
): { lines: string[]; fontSize: number } {
  const clean = text.trim();
  if (!clean) return { lines: [" "], fontSize: LABEL_FLOOR };

  const words = clean.split(/\s+/);
  const candidates: string[][] = [[clean]];
  if (words.length > 1) candidates.push(balancedSplit(words));

  let best: { lines: string[]; fontSize: number } | null = null;
  for (const lines of candidates) {
    const longest = Math.max(...lines.map((l) => l.length));
    const fByWidth = (boxWidth * LABEL_FILL) / (longest * CHAR_W);
    const fByHeight = (boxHeight * LABEL_FILL) / (lines.length * LINE_HEIGHT);
    const fontSize = Math.min(LABEL_CAP, fByWidth, fByHeight);
    if (!best || fontSize > best.fontSize) best = { lines, fontSize };
  }

  const chosen = best!;
  return {
    lines: chosen.lines,
    fontSize: Math.max(LABEL_FLOOR, Math.round(chosen.fontSize)),
  };
}
