import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Nav from "../src/components/Nav";

describe("Nav", () => {
  it("renders Map and Tracker links", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: /map/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /tracker/i })).toBeDefined();
  });
});
