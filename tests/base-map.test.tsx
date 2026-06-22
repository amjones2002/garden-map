import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import BaseMap from "../src/components/BaseMap";

describe("BaseMap", () => {
  it("does not render real street names (privacy)", () => {
    const { container } = render(
      <svg>
        <BaseMap />
      </svg>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/eastview/i);
    expect(text).not.toMatch(/baltimore/i);
  });
});
