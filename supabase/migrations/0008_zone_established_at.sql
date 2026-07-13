-- Temporal bed filter: when a bed was built. A photo is only offered beds whose
-- established_at is null (predates the photo record / permanent) or on/before the
-- photo's taken_at. Areas are time-stable, so this only affects the bed step.

alter table zones add column if not exists established_at date;

-- Per-bed dates. Beds that predate the 2024-10 start of the photo record stay
-- null (never filtered out). Fill the young beds below from the hint script
-- (`node scripts/established-at-hints.mjs`) + real memory, then apply.
--
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'stock-tank';
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'cedar-planters';
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'the-field';
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'front-street-beds';
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'front-raised-bed';
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'field-bed-vines';
-- update zones set established_at = 'YYYY-MM-DD' where slug = 'dry-mineral-bed';
