-- Zone soft-delete (archive) + updated_at audit column.
alter table zones add column if not exists archived_at timestamptz;
alter table zones add column if not exists updated_at timestamptz not null default now();

-- Active zones are those not archived.
create index if not exists zones_active_idx on zones (sort_order) where archived_at is null;
