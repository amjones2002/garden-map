import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MapLabels from "../src/components/MapLabels";
import type { MapLabel } from "../src/lib/types";

const base: MapLabel = {
  id: "1",
  text: "Street",
  x: 0.06,
  y: 0.52,
  font_size: 32,
  color: "#7a6a44",
  rotation: -82,
  created_at: "",
  updated_at: "",
  archived_at: null,
};

describe("MapLabels", () => {
  it("applies a rotation transform when rotation is non-zero", () => {
    const { container } = render(
      <svg>
        <MapLabels labels={[base]} />
      </svg>,
    );
    const t = container.querySelector("text");
    expect(t?.getAttribute("transform")).toBe("rotate(-82 60 520)");
  });

  it("omits the transform attribute when rotation is zero", () => {
    const { container } = render(
      <svg>
        <MapLabels labels={[{ ...base, rotation: 0 }]} />
      </svg>,
    );
    const t = container.querySelector("text");
    expect(t?.getAttribute("transform")).toBeNull();
  });
});
