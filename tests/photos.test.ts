import { describe, it, expect } from "vitest";
import { publicPhotoUrl, sortChronological } from "../src/lib/photos";

describe("photos lib", () => {
  it("builds a public storage URL", () => {
    expect(publicPhotoUrl("https://x.supabase.co", "z1/a.jpg")).toBe(
      "https://x.supabase.co/storage/v1/object/public/zone-photos/z1/a.jpg",
    );
  });

  it("sorts chronologically by taken_at, falling back to uploaded_at (oldest first)", () => {
    const photos = [
      { id: "a", taken_at: "2026-05-01", uploaded_at: "2026-06-01" },
      { id: "b", taken_at: null, uploaded_at: "2026-04-01" },
      { id: "c", taken_at: "2026-03-01", uploaded_at: "2026-06-02" },
    ];
    expect(sortChronological(photos).map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});
