-- Photo classification: area layer on zones, review-queue + AI enrichment on
-- zone_photos, and confirmed-only public read.

-- 1) AREA LAYER ON ZONES ----------------------------------------------------
alter table zones add column if not exists area text
  check (area is null or area in ('front','pool','south'));

-- Backfill by slug, falling back to name (robust to editor-generated slugs).
update zones set area = 'front'
  where area is null and (
    slug in ('hellstrip','foundation-bed','north-side-yard','stock-tank','front-yard')
    or lower(name) in ('hellstrip','foundation bed','north side yard','stock tank fountain','front yard')
  );
update zones set area = 'pool'
  where area is null and (
    slug in ('cedar-planters','pool-spa','alley')
    or lower(name) in ('cedar planters','pool & spa','pool','alley')
  );
update zones set area = 'south'
  where area is null and (
    slug in ('dry-mineral-bed','front-raised-bed')
    or lower(name) in ('dry mineral bed','front raised bed (8x3)','front raised bed')
  );

-- 2) REVIEW QUEUE + AI ENRICHMENT ON ZONE_PHOTOS ----------------------------
alter table zone_photos alter column zone_id drop not null;

alter table zone_photos
  add column if not exists area text
    check (area is null or area in ('front','pool','south')),
  add column if not exists review_status text not null default 'confirmed'
    check (review_status in ('pending','confirmed','rejected')),
  add column if not exists source text not null default 'manual'
    check (source in ('manual','batch_import','phone_sync')),
  add column if not exists source_ref text,
  add column if not exists ai_zone_slug text,
  add column if not exists ai_area text,
  add column if not exists ai_confidence numeric,
  add column if not exists ai_model text,
  add column if not exists caption text,
  add column if not exists is_yard boolean,
  add column if not exists ai_meta jsonb not null default '{}'::jsonb;

-- Idempotent re-runs: a given source photo imports at most once.
create unique index if not exists zone_photos_source_ref_idx
  on zone_photos (source_ref) where source_ref is not null;

-- Review-queue and enrichment query paths.
create index if not exists zone_photos_review_status_idx on zone_photos (review_status);
create index if not exists zone_photos_area_idx on zone_photos (area);
create index if not exists zone_photos_ai_meta_idx on zone_photos using gin (ai_meta);

-- 3) PUBLIC READ = CONFIRMED ONLY ------------------------------------------
drop policy if exists "public read zone_photos" on zone_photos;
create policy "public read zone_photos" on zone_photos
  for select using (review_status = 'confirmed');
