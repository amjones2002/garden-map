export type Area = "front" | "pool" | "south";
export type ReviewStatus = "pending" | "confirmed" | "rejected";
export type PhotoSource = "manual" | "batch_import" | "phone_sync";
export type ReviewAction = "confirmed_asis" | "reassigned" | "rejected";

export type AiMeta = {
  quality?: "good" | "ok" | "poor";
  reasoning?: string;
  tags?: string[];
  plants?: string[];
  hardscape?: Record<string, boolean>;
  botanical?: { bloom_colors?: string[]; notes?: string };
  capture_source?: string;
  [key: string]: unknown;
};

export type Zone = {
  id: string;
  slug: string;
  name: string;
  label: string | null;
  description: string | null;
  shape: { x: number; y: number }[];
  fill_color: string | null;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  archived_at?: string | null;
  area: Area | null;
};

export type Vendor = {
  id: string;
  name: string;
  url: string | null;
  notes: string | null;
  sort_order: number;
};

export type MapLabel = {
  id: string;
  text: string;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  font_size: number;
  color: string | null;
  rotation: number; // degrees
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type PurchaseStatus = "planted" | "pending" | "replaced" | "died";

export type Purchase = {
  id: string;
  zone_id: string | null;
  common_name: string;
  botanical_name: string | null;
  catalog_id: string | null;
  vendor_id: string | null;
  purchase_date: string | null;
  price: number | null;
  price_estimated: boolean;
  quantity: number;
  status: PurchaseStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ZonePhoto = {
  id: string;
  zone_id: string | null;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  uploaded_at: string;
  sort_order: number;
  area: Area | null;
  review_status: ReviewStatus;
  source: PhotoSource;
  source_ref: string | null;
  ai_zone_slug: string | null;
  ai_area: Area | null;
  ai_confidence: number | null;
  ai_model: string | null;
  is_yard: boolean | null;
  ai_meta: AiMeta;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  reviewed_at: string | null;
  review_action: ReviewAction | null;
};

export type PlantCatalog = {
  id: string;
  scientific_name: string;
  common_name: string | null;
  other_common_names: string | null;
  growth_form: string | null;
  height_min: number | null;
  height_max: number | null;
  spread_min: number | null;
  spread_max: number | null;
  light: string | null;
  water: string | null;
  soil: string | null;
  bloom_season: string | null;
  bloom_color: string | null;
  wildlife_benefit: string | null;
  native_habitat: string | null;
  ecoregions: string[];
  is_tx_native: boolean;
  source: string;
  source_url: string | null;
  created_at: string;
};
