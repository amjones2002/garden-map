import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TimelineView from "../src/app/timeline/TimelineView";

const eras = [
  { key: "era-0", title: "Before the Build", blurb: "An established yard.", milestones: [],
    start: "2024-10-17", end: "2025-04-13", coverPath: null, generatedAt: "", model: "",
    seasons: [{ key: "fall-2024", label: "Fall 2024", photos: [
      { id: "p1", storagePath: "z/a.jpg", caption: "pool", takenAt: "2024-10-17T00:00:00Z", zoneName: "Pool & Spa", quality: "good", bloomColors: ["pink"], reasoning: null },
    ] }] },
];

describe("TimelineView", () => {
  it("renders era titles, blurbs, and a rail entry per era", () => {
    render(<TimelineView eras={eras as never} />);
    expect(screen.getAllByText("Before the Build").length).toBeGreaterThan(0);
    expect(screen.getByText("An established yard.")).toBeInTheDocument();
    expect(screen.getByText(/Fall 2024/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no eras", () => {
    render(<TimelineView eras={[]} />);
    expect(screen.getByText(/timeline hasn.t been generated/i)).toBeInTheDocument();
  });
});
