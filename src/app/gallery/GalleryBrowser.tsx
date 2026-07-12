"use client";
import type { PhotoFacet } from "@/lib/photo-facets";

export default function GalleryBrowser({ facets }: { facets: PhotoFacet[] }) {
  return <div data-testid="gallery-count">{facets.length} photos</div>;
}
