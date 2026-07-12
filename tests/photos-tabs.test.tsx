import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhotosTabs from "../src/app/photos/PhotosTabs";

const props = { sections: [], zones: [], pendingCount: 7, initialTab: "upload" as const };

describe("PhotosTabs", () => {
  it("defaults to the upload tab and shows the pending count on the review tab", () => {
    render(<PhotosTabs {...props} />);
    expect(screen.getByTestId("tab-upload")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-review")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /to review/i })).toHaveTextContent("7");
  });

  it("switches to the review tab on click", () => {
    render(<PhotosTabs {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /to review/i }));
    expect(screen.getByTestId("tab-review")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-upload")).not.toBeInTheDocument();
  });

  it("honors initialTab=review", () => {
    render(<PhotosTabs {...props} initialTab="review" />);
    expect(screen.getByTestId("tab-review")).toBeInTheDocument();
  });
});
