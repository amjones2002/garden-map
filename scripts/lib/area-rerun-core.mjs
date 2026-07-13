/** Decide the area patch for a NON-human-reviewed photo given the GPS-derived
 *  area. null = no change. A disagreement re-opens the photo for review; a null
 *  stored area is filled silently. */
export function planAreaRerun(row, gpsArea) {
  if (!gpsArea) return null;
  if (row.area === gpsArea) return null;
  if (row.area == null) return { area: gpsArea };
  return { area: gpsArea, review_status: "pending" };
}
