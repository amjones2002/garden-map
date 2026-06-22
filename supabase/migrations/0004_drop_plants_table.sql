-- Purchases are the single intake for plants; a zone's "currently planted"
-- list is derived from purchases (status = 'planted'). The standalone plants
-- table is no longer used.
drop table if exists plants;
