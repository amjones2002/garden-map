-- Garden Map — initial schema
-- Public read-only (RLS SELECT for everyone); writes only via service_role.

create extension if not exists "pgcrypto";

-- VENDORS
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  url text,
  notes text,
  sort_order int not null default 0
);

-- ZONES
create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  label text,
  description text,
  shape jsonb not null default '[]'::jsonb,   -- [{x,y},...] normalized 0..1
  fill_color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- PLANT CATALOG
create table if not exists plant_catalog (
  id uuid primary key default gen_random_uuid(),
  scientific_name text not null,
  common_name text,
  other_common_names text,
  growth_form text,
  height_min numeric,
  height_max numeric,
  spread_min numeric,
  spread_max numeric,
  light text,
  water text,
  soil text,
  bloom_season text,
  bloom_color text,
  wildlife_benefit text,
  native_habitat text,
  ecoregions text[] not null default '{}',
  is_tx_native boolean not null default true,
  source text not null,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists plant_catalog_common_name_idx on plant_catalog (lower(common_name));
create index if not exists plant_catalog_scientific_name_idx on plant_catalog (lower(scientific_name));

-- PLANTS (curated "currently planted here" list)
create table if not exists plants (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones(id) on delete cascade,
  common_name text not null,
  botanical_name text,
  catalog_id uuid references plant_catalog(id) on delete set null,
  sort_order int not null default 0
);

-- PURCHASES (the tracker log)
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references zones(id) on delete set null,
  common_name text not null,
  botanical_name text,
  catalog_id uuid references plant_catalog(id) on delete set null,
  vendor_id uuid references vendors(id) on delete set null,
  purchase_date date,
  price numeric,
  price_estimated boolean not null default false,
  quantity int not null default 1,
  status text not null default 'planted'
    check (status in ('planted','pending','replaced','died')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_zone_idx on purchases (zone_id);
create index if not exists purchases_status_idx on purchases (status);

-- ZONE PHOTOS
create table if not exists zone_photos (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zones(id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  uploaded_at timestamptz not null default now(),
  sort_order int not null default 0
);

-- ROW LEVEL SECURITY: public read, no public write.
-- Writes are performed by the service_role key (which bypasses RLS) via server code.
alter table vendors        enable row level security;
alter table zones          enable row level security;
alter table plant_catalog  enable row level security;
alter table plants         enable row level security;
alter table purchases      enable row level security;
alter table zone_photos    enable row level security;

-- Public SELECT policies (anon + authenticated). Drop-and-create for idempotency.
drop policy if exists "public read vendors"       on vendors;
drop policy if exists "public read zones"         on zones;
drop policy if exists "public read plant_catalog" on plant_catalog;
drop policy if exists "public read plants"        on plants;
drop policy if exists "public read purchases"     on purchases;
drop policy if exists "public read zone_photos"   on zone_photos;

create policy "public read vendors"       on vendors       for select using (true);
create policy "public read zones"         on zones         for select using (true);
create policy "public read plant_catalog" on plant_catalog for select using (true);
create policy "public read plants"        on plants        for select using (true);
create policy "public read purchases"     on purchases     for select using (true);
create policy "public read zone_photos"   on zone_photos   for select using (true);
-- No INSERT/UPDATE/DELETE policies => anon cannot write. service_role bypasses RLS.
