-- Phase 1: camera GPS + human-review provenance on zone_photos, and a
-- singleton georeference transform (lat/lng -> normalized 0..1 map space).

-- 1) GPS + PROVENANCE ON ZONE_PHOTOS ---------------------------------------
alter table zone_photos
  add column if not exists gps_lat numeric,
  add column if not exists gps_lng numeric,
  add column if not exists gps_accuracy numeric,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_action text
    check (review_action is null
           or review_action in ('confirmed_asis','reassigned','rejected'));

-- Georeference-fit query path (human-reviewed rows that carry a fix).
create index if not exists zone_photos_gps_idx
  on zone_photos (gps_lat, gps_lng) where gps_lat is not null;

-- 2) GEOREFERENCE TRANSFORM (singleton) ------------------------------------
create table if not exists map_georeference (
  id int primary key default 1,
  a double precision not null,
  b double precision not null,
  c double precision not null,
  d double precision not null,
  e double precision not null,
  f double precision not null,
  n_points int not null,
  rms double precision not null,
  fitted_at timestamptz not null default now(),
  constraint map_georeference_singleton check (id = 1)
);

-- Read only via the service role (classify route + scripts); no public policy.
alter table map_georeference enable row level security;
