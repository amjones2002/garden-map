import { describe, it, expect } from "vitest";
import {
  PURCHASE_STATUSES,
  toCsv,
  filterPurchases,
  sortPurchases,
  normalizeImportRow,
} from "../src/lib/purchases";

const rows = [
  { id: "1", common_name: "Turk's Cap", zone_id: "z1", vendor_id: "v1", status: "planted", price: 8, purchase_date: "2026-04-01", quantity: 1 },
  { id: "2", common_name: "Sotol", zone_id: "z2", vendor_id: null, status: "died", price: 20, purchase_date: "2026-03-15", quantity: 2 },
  { id: "3", common_name: "Catmint", zone_id: "z1", vendor_id: "v1", status: "pending", price: null, purchase_date: null, quantity: 1 },
] as any[];

describe("purchases lib", () => {
  it("exposes the four statuses", () => {
    expect(PURCHASE_STATUSES).toEqual(["planted", "pending", "replaced", "died"]);
  });

  it("filters by zone and status", () => {
    expect(filterPurchases(rows, { zoneId: "z1" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterPurchases(rows, { status: "died" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by case-insensitive search on common_name", () => {
    expect(filterPurchases(rows, { search: "cat" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("sorts by price ascending and descending (nulls last)", () => {
    expect(sortPurchases(rows, "price", "asc").map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(sortPurchases(rows, "price", "desc").map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("exports CSV with a header and zone names resolved", () => {
    const csv = toCsv([rows[0]], { z1: "Front Raised Bed" }, { v1: "Calloway's" });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("common_name");
    expect(lines[1]).toContain("Turk's Cap");
    expect(lines[1]).toContain("Front Raised Bed");
    expect(lines[1]).toContain("Calloway's");
  });

  it("normalizes a lenient import row: only common_name required", () => {
    const { row, warnings } = normalizeImportRow({ common_name: " Frogfruit " });
    expect(row.common_name).toBe("Frogfruit");
    expect(row.quantity).toBe(1);
    expect(row.status).toBe("planted");
    expect(row.price_estimated).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("flags estimated price and coerces numbers", () => {
    const { row } = normalizeImportRow({ common_name: "X", price: "$12.50", quantity: "3" });
    expect(row.price).toBe(12.5);
    expect(row.price_estimated).toBe(true);
    expect(row.quantity).toBe(3);
  });

  it("warns and defaults on invalid status; rejects empty name", () => {
    const ok = normalizeImportRow({ common_name: "Y", status: "bogus" });
    expect(ok.row.status).toBe("planted");
    expect(ok.warnings.some((w) => /status/i.test(w))).toBe(true);
    const bad = normalizeImportRow({ common_name: "  " });
    expect(bad.row).toBeNull();
    expect(bad.warnings.some((w) => /name/i.test(w))).toBe(true);
  });
});
