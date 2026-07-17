import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import GalleryBrowser from "../src/app/gallery/GalleryBrowser";
import { EditModeProvider } from "../src/lib/edit-mode";
import type { PhotoFacet } from "../src/lib/photo-facets";

const renderGallery = (facets: PhotoFacet[]) =>
  render(
    <EditModeProvider>
      <GalleryBrowser facets={facets} />
    </EditModeProvider>,
  );

const f = (over: Partial<PhotoFacet>): PhotoFacet =>
  ({ id: "p", storagePath: "z/a.jpg", takenAt: "2025-05-01T00:00:00Z", zoneId: "z-pool",
     zoneName: "Pool & Spa", area: "pool", quality: "good", caption: "pink salvia",
     reasoning: null, bloomColors: ["pink"], milestones: ["raised_beds"], eraKey: "era-1",
     season: "spring", year: 2025, searchText: "pink salvia", ...over }) as PhotoFacet;

describe("GalleryBrowser", () => {
  const facets = [
    f({ id: "a", area: "pool", bloomColors: ["pink"] }),
    f({ id: "b", area: "front", zoneName: "Hellstrip", zoneId: "z-hell", bloomColors: ["yellow"], searchText: "yellow lantana" }),
  ];

  it("shows the total count initially", () => {
    renderGallery(facets);
    expect(screen.getByText(/2 photos/i)).toBeInTheDocument();
  });

  it("narrows results when an area chip is toggled", () => {
    renderGallery(facets);
    fireEvent.click(within(screen.getByTestId("facet-area")).getByRole("button", { name: /front/i }));
    expect(screen.getByText(/1 photo/i)).toBeInTheDocument();
  });

  it("filters by free-text search", () => {
    renderGallery(facets);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "lantana" } });
    expect(screen.getByText(/1 photo/i)).toBeInTheDocument();
  });

  it("clears filters", () => {
    renderGallery(facets);
    fireEvent.click(within(screen.getByTestId("facet-area")).getByRole("button", { name: /front/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByText(/2 photos/i)).toBeInTheDocument();
  });
});
