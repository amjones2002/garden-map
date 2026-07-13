-- Temporal bed filter: when a bed was built. A photo is only offered beds whose
-- established_at is null (predates the photo record / permanent) or on/before the
-- photo's taken_at. Areas are time-stable, so this only affects the bed step.

alter table zones add column if not exists established_at date;

-- Per-bed dates (young beds built during the photo record). Beds that predate the
-- 2024-10 start of the record are left null (never filtered out). Idempotent —
-- re-running sets the same values. `front-raised-bed` is the south "Raised Beds".
update zones set established_at = '2025-06-29' where slug = 'stock-tank';
update zones set established_at = '2026-06-01' where slug = 'cedar-planters';
update zones set established_at = '2025-05-17' where slug = 'the-field';
update zones set established_at = '2025-05-11' where slug = 'front-street-beds';
update zones set established_at = '2025-10-18' where slug = 'front-raised-bed';
update zones set established_at = '2025-04-12' where slug = 'field-bed-vines';
update zones set established_at = '2025-11-05' where slug = 'dry-mineral-bed';
