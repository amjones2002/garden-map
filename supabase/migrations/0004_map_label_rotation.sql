-- Add rotation (degrees) to map labels, and seed the former hardcoded
-- street labels as generic, editable DB rows (privacy: no real names).
alter table map_labels add column if not exists rotation real not null default 0;

-- Seed generic street/alley labels at the old on-map positions.
-- Coordinates are normalized 0..1; MapLabels renders them center-anchored,
-- so these approximate the prior placement and may be nudged in the editor.
insert into map_labels (text, x, y, font_size, color, rotation)
select 'Street', 0.06, 0.52, 32, '#7a6a44', -82
where not exists (select 1 from map_labels where text = 'Street' and archived_at is null);

insert into map_labels (text, x, y, font_size, color, rotation)
select 'Drive', 0.50, 0.945, 32, '#7a6a44', 0
where not exists (select 1 from map_labels where text = 'Drive' and archived_at is null);

insert into map_labels (text, x, y, font_size, color, rotation)
select 'alley', 0.945, 0.50, 22, '#9c8567', 90
where not exists (select 1 from map_labels where text = 'alley' and archived_at is null);
