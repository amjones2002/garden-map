export const PURCHASE_STATUSES = ["planted", "pending", "replaced", "died"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

type AnyRow = Record<string, unknown> & {
  id?: string;
  common_name?: string;
  zone_id?: string | null;
  vendor_id?: string | null;
  status?: string;
  price?: number | null;
};

export type PurchaseFilters = {
  zoneId?: string;
  status?: string;
  vendorId?: string;
  search?: string;
};

export function filterPurchases<T extends AnyRow>(rows: T[], f: PurchaseFilters): T[] {
  return rows.filter((r) => {
    if (f.zoneId && r.zone_id !== f.zoneId) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.vendorId && r.vendor_id !== f.vendorId) return false;
    if (f.search) {
      const hay = `${r.common_name ?? ""}`.toLowerCase();
      if (!hay.includes(f.search.toLowerCase())) return false;
    }
    return true;
  });
}

/** Sort by a key; null/undefined always sort last regardless of direction. */
export function sortPurchases<T extends AnyRow>(rows: T[], key: string, dir: "asc" | "desc"): T[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    const aNull = av === null || av === undefined || av === "";
    const bNull = bv === null || bv === undefined || bv === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
  return copy;
}

const CSV_COLUMNS = [
  "common_name",
  "botanical_name",
  "zone",
  "vendor",
  "purchase_date",
  "price",
  "price_estimated",
  "quantity",
  "status",
  "notes",
] as const;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(
  rows: AnyRow[],
  zoneNames: Record<string, string> = {},
  vendorNames: Record<string, string> = {},
): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const cells = [
      r.common_name,
      r["botanical_name"],
      r.zone_id ? zoneNames[r.zone_id as string] ?? "" : "",
      r.vendor_id ? vendorNames[r.vendor_id as string] ?? "" : "",
      r["purchase_date"],
      r.price,
      r["price_estimated"],
      r["quantity"],
      r.status,
      r["notes"],
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

export type ImportRow = {
  common_name: string;
  botanical_name: string | null;
  zone_ref: string | null;
  vendor_ref: string | null;
  purchase_date: string | null;
  price: number | null;
  price_estimated: boolean;
  quantity: number;
  status: PurchaseStatus;
  notes: string | null;
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const parsePrice = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Lenient mapping of a raw CSV record to an import row.
 * Only `common_name` is required. Returns `{ row: null }` with a warning when missing.
 */
export function normalizeImportRow(raw: Record<string, unknown>): { row: ImportRow | null; warnings: string[] } {
  const warnings: string[] = [];
  const common_name = str(raw.common_name ?? raw["Plant name"] ?? raw["plant_name"] ?? raw["name"]);
  if (!common_name) {
    return { row: null, warnings: ["Missing plant name (common_name) — row skipped"] };
  }

  const price = parsePrice(raw.price ?? raw["Price"]);

  let quantity = 1;
  const qRaw = str(raw.quantity ?? raw["Quantity"] ?? raw["qty"]);
  if (qRaw !== null) {
    const q = parseInt(qRaw, 10);
    if (Number.isFinite(q) && q > 0) quantity = q;
  }

  let status: PurchaseStatus = "planted";
  const sRaw = str(raw.status ?? raw["Status"]);
  if (sRaw !== null) {
    const lower = sRaw.toLowerCase();
    if ((PURCHASE_STATUSES as readonly string[]).includes(lower)) {
      status = lower as PurchaseStatus;
    } else {
      warnings.push(`Unknown status "${sRaw}" — defaulted to planted`);
    }
  }

  const row: ImportRow = {
    common_name,
    botanical_name: str(raw.botanical_name ?? raw["Botanical name"] ?? raw["botanical"]),
    zone_ref: str(raw.zone ?? raw["Zone"] ?? raw["zone_ref"]),
    vendor_ref: str(raw.vendor ?? raw["Vendor"] ?? raw["source"] ?? raw["Source"]),
    purchase_date: str(raw.purchase_date ?? raw["Purchase date"] ?? raw["date"] ?? raw["Date"]),
    price,
    price_estimated: price !== null,
    quantity,
    status,
    notes: str(raw.notes ?? raw["Notes"]),
  };
  return { row, warnings };
}
