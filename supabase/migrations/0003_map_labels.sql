-- Independent free-floating map text labels (not tied to a zone/bed).
create extension if not exists "pgcrypto";

create table if not exists map_labels (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  x numeric not null,            -- normalized 0..1
  y numeric not null,            -- normalized 0..1
  font_size int not null default 30,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table map_labels enable row level security;
drop policy if exists "public read map_labels" on map_labels;
create policy "public read map_labels" on map_labels for select using (true);
