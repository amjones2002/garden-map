import type { Area, Zone, ZonePhoto } from "./types";

export const AREA_ORDER: Area[] = ["front", "pool", "south"];
export const AREA_LABELS: Record<Area, string> = { front: "Front", pool: "Pool", south: "South" };

/** Zones sorted alphabetically by name, for dropdown display (independent of map sort_order). */
export function sortZonesByName(zones: Zone[]): Zone[] {
  return [...zones].sort((a, b) => a.name.localeCompare(b.name));
}

/** The area a zone belongs to (null when the zone/id is unknown). */
export function areaForZone(zoneId: string | null, zones: Zone[]): Area | null {
  if (!zoneId) return null;
  return zones.find((z) => z.id === zoneId)?.area ?? null;
}

export type ZoneGroup = {
  zoneSlug: string | null;
  zoneName: string;
  zoneId: string | null;
  photos: ZonePhoto[];
};

export type AreaSection = {
  area: Area | null;
  label: string;
  groups: ZoneGroup[];
  areaOnly: ZonePhoto[];
};

/**
 * Two-level grouping for the review queue: Area -> Zone groups (by ai_zone_slug,
 * largest first) plus an areaOnly bucket (ai_zone_slug === null). Areas appear in
 * AREA_ORDER, then a final null-area section for photos with no ai_area. Empty
 * areas are omitted.
 */
export function groupPendingByAreaZone(photos: ZonePhoto[], zones: Zone[]): AreaSection[] {
  const zoneBySlug = new Map(zones.map((z) => [z.slug, z]));
  const sections: AreaSection[] = [];

  for (const area of [...AREA_ORDER, null] as (Area | null)[]) {
    const inArea = photos.filter((p) => p.ai_area === area);
    if (inArea.length === 0) continue;

    const bySlug = new Map<string, ZonePhoto[]>();
    const areaOnly: ZonePhoto[] = [];
    for (const p of inArea) {
      if (p.ai_zone_slug) {
        const list = bySlug.get(p.ai_zone_slug) ?? [];
        list.push(p);
        bySlug.set(p.ai_zone_slug, list);
      } else {
        areaOnly.push(p);
      }
    }

    const groups: ZoneGroup[] = [...bySlug.entries()]
      .map(([slug, groupPhotos]) => {
        const zone = zoneBySlug.get(slug);
        return {
          zoneSlug: slug,
          zoneName: zone?.name ?? slug,
          zoneId: zone?.id ?? null,
          photos: groupPhotos,
        };
      })
      .sort((a, b) => b.photos.length - a.photos.length);

    sections.push({
      area,
      label: area ? AREA_LABELS[area] : "Area unknown",
      groups,
      areaOnly,
    });
  }

  return sections;
}
