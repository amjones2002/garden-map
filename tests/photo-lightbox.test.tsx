import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhotoLightbox from "../src/components/PhotoLightbox";

describe("PhotoLightbox", () => {
  const meta = { caption: "A caption", takenAt: null, zoneName: "Pool & Spa" };

  it("renders the image and the meta panel", () => {
    render(<PhotoLightbox src="https://x/y.jpg" alt="alt text" meta={meta} onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "alt text" })).toBeInTheDocument();
    expect(screen.getByText("A caption")).toBeInTheDocument();
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<PhotoLightbox src="https://x/y.jpg" alt="a" meta={meta} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows no delete control when onDelete is absent", () => {
    render(<PhotoLightbox src="https://x/y.jpg" alt="a" meta={meta} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("confirms before calling onDelete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<PhotoLightbox src="https://x/y.jpg" alt="a" meta={meta} onClose={() => {}} onDelete={onDelete} />);
    // First click reveals confirmation, does not delete yet.
    fireEvent.click(screen.getByRole("button", { name: /delete photo/i }));
    expect(onDelete).not.toHaveBeenCalled();
    // Confirm.
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
