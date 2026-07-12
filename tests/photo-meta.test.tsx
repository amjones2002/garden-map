import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PhotoMeta from "../src/components/PhotoMeta";

describe("PhotoMeta", () => {
  it("shows caption, zone, quality and normalized bloom swatches", () => {
    render(
      <PhotoMeta
        caption="View across the pool."
        takenAt="2024-10-17T16:45:50Z"
        zoneName="Pool & Spa"
        quality="good"
        bloomColors={["light pink", "lavender"]}
        reasoning="Kidney pool visible."
      />,
    );
    expect(screen.getByText("View across the pool.")).toBeInTheDocument();
    expect(screen.getByText(/Pool & Spa/)).toBeInTheDocument();
    expect(screen.getByText(/good/i)).toBeInTheDocument();
    // pink + purple (lavender→purple), de-duped
    expect(screen.getByLabelText("Pink")).toBeInTheDocument();
    expect(screen.getByLabelText("Purple")).toBeInTheDocument();
  });

  it("hides the AI Summary body by default (details collapsed)", () => {
    render(<PhotoMeta caption="c" takenAt={null} zoneName={null} reasoning="secret reasoning" />);
    const summary = screen.getByText(/AI Summary/i);
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("omits sections with no data and never renders plants/tags", () => {
    render(<PhotoMeta caption="just a caption" takenAt={null} zoneName={null} />);
    expect(screen.queryByText(/Blooming/i)).toBeNull();
    expect(screen.queryByText(/AI Summary/i)).toBeNull();
    expect(screen.queryByText(/salvia/i)).toBeNull();
  });
});
