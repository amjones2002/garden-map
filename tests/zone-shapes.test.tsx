import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ZoneShapes from "../src/components/ZoneShapes";
import type { Zone } from "../src/lib/types";

function zone(overrides: Partial<Zone>): Zone {
  return {
    id: "z1",
    slug: "z1",
    name: "Zone",
    label: null,
    description: null,
    shape: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    fill_color: null,
    sort_order: 0,
    created_at: "",
    area: null,
    ...overrides,
  };
}

describe("ZoneShapes labels", () => {
  it("wraps a long name in a narrow tall zone onto two tspans", () => {
    const z = zone({
      name: "Front Street Beds",
      shape: [
        { x: 0.0, y: 0.0 },
        { x: 0.12, y: 0.0 },
        { x: 0.12, y: 0.9 },
        { x: 0.0, y: 0.9 },
      ],
    });
    const { container } = render(
      <svg>
        <ZoneShapes zones={[z]} selectedId={null} onSelect={() => {}} />
      </svg>,
    );
    const tspans = container.querySelectorAll("text tspan");
    expect(tspans.length).toBe(2);
    expect(Array.from(tspans).map((t) => t.textContent).join(" ")).toBe(
      "Front Street Beds",
    );
  });

  it("shrinks the font below the 34 cap for a small zone", () => {
    const z = zone({
      name: "Driveway",
      shape: [
        { x: 0.0, y: 0.0 },
        { x: 0.06, y: 0.0 },
        { x: 0.06, y: 0.05 },
        { x: 0.0, y: 0.05 },
      ],
    });
    const { container } = render(
      <svg>
        <ZoneShapes zones={[z]} selectedId={null} onSelect={() => {}} />
      </svg>,
    );
    const text = container.querySelector("text");
    expect(Number(text?.getAttribute("font-size"))).toBeLessThan(34);
  });
});
