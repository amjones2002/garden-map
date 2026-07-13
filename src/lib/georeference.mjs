// Pure geometry + georeference math shared by the classify route and the
// fit / area-rerun scripts. No DB or IO here. Coordinates are normalized
// 0..1 map space unless noted.

export const MIN_POINTS = 8;
export const MIN_ZONES = 3;

/** Area-weighted polygon centroid; vertex mean for degenerate shapes. */
export function polygonCentroid(shape) {
  const n = shape.length;
  if (n === 0) return null;
  const mean = () => {
    const s = shape.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / n, y: s.y / n };
  };
  if (n < 3) return mean();
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = shape[i], q = shape[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) return mean();
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Ray-casting point-in-polygon. pt and shape in the same coordinate space. */
export function pointInPolygon(pt, shape) {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const xi = shape[i].x, yi = shape[i].y, xj = shape[j].x, yj = shape[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Solve 3x3 Ax=b (Gaussian elimination, partial pivot). null if singular. */
function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let k = col; k < 4; k++) m[r][k] -= factor * m[col][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Map a lat/lng to normalized 0..1 map space via a fitted transform. */
export function applyAffine(t, lat, lng) {
  return { x: t.a * lng + t.b * lat + t.c, y: t.d * lng + t.e * lat + t.f };
}

/** Drop gross geographic outliers before fitting: keep only control points
 *  within `maxMeters` of the median lat/lng. On a 0.25-acre plot every real
 *  photo sits within ~30 m of center, but an off-site photo or a bad GPS fix
 *  can land kilometers away and, left in, would dominate the least-squares
 *  affine fit. Median-centered so the outliers themselves don't skew the
 *  reference point. Pure; returns a new array. */
export function filterPlotOutliers(points, maxMeters = 100) {
  if (points.length === 0) return [];
  const median = (vals) => {
    const a = [...vals].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const clat = median(points.map((p) => p.lat));
  const clng = median(points.map((p) => p.lng));
  const kLat = 111320, kLng = 111320 * Math.cos((clat * Math.PI) / 180);
  return points.filter((p) => {
    const dx = (p.lng - clng) * kLng, dy = (p.lat - clat) * kLat;
    return Math.hypot(dx, dy) <= maxMeters;
  });
}

/** Least-squares affine fit lat/lng -> map x/y from control points
 *  [{lat,lng,x,y,zoneId}]. Requires >= MIN_POINTS across >= MIN_ZONES zones.
 *  Returns {a,b,c,d,e,f,n,rms} or null. */
export function fitAffine(points) {
  const zoneIds = new Set(points.map((p) => p.zoneId));
  if (points.length < MIN_POINTS || zoneIds.size < MIN_ZONES) return null;
  // Mean-center lat/lng to condition the normal equations: a 0.25-acre plot
  // spans ~0.0003 deg around lng~-96 / lat~32, so un-centered ATA is
  // near-singular. Center, fit, then fold the offset back into c/f.
  const n = points.length;
  let mlng = 0, mlat = 0;
  for (const p of points) { mlng += p.lng; mlat += p.lat; }
  mlng /= n; mlat /= n;
  const ATA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const ATx = [0, 0, 0], ATy = [0, 0, 0];
  for (const p of points) {
    const row = [p.lng - mlng, p.lat - mlat, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ATA[i][j] += row[i] * row[j];
      ATx[i] += row[i] * p.x;
      ATy[i] += row[i] * p.y;
    }
  }
  const bx = solve3(ATA, ATx);
  const by = solve3(ATA, ATy);
  if (!bx || !by) return null;
  // x = bx0*(lng-mlng) + bx1*(lat-mlat) + bx2
  //   = bx0*lng + bx1*lat + (bx2 - bx0*mlng - bx1*mlat)
  const t = {
    a: bx[0], b: bx[1], c: bx[2] - bx[0] * mlng - bx[1] * mlat,
    d: by[0], e: by[1], f: by[2] - by[0] * mlng - by[1] * mlat,
  };
  let se = 0;
  for (const p of points) {
    const q = applyAffine(t, p.lat, p.lng);
    se += (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  }
  return { ...t, n: points.length, rms: Math.sqrt(se / points.length) };
}

/** Resolve a GPS point to { area, shortlist } using the transform and zone
 *  polygons. area = containing zone's area, else nearest zone's area.
 *  shortlist = up to 3 nearest-centroid zone slugs within that area.
 *  Returns null when no zone has usable geometry or no area resolves. */
export function resolveGpsHint(transform, lat, lng, zones) {
  const withShape = zones.filter((z) => Array.isArray(z.shape) && z.shape.length >= 3);
  if (withShape.length === 0) return null;
  const pt = applyAffine(transform, lat, lng);
  const dist = (z) => {
    const c = polygonCentroid(z.shape);
    return (c.x - pt.x) ** 2 + (c.y - pt.y) ** 2;
  };
  const containing = withShape.find((z) => pointInPolygon(pt, z.shape));
  const nearest = withShape.reduce((best, z) => (dist(z) < dist(best) ? z : best), withShape[0]);
  const area = (containing ?? nearest).area ?? null;
  if (!area) return null;
  const shortlist = withShape
    .filter((z) => z.area === area)
    .sort((p, q) => dist(p) - dist(q))
    .slice(0, 3)
    .map((z) => z.slug);
  return { area, shortlist };
}
