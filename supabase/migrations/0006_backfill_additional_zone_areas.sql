-- Assign areas to zones that were added live in the editor after 0005 was
-- written (so they become classification targets). Idempotent.
update zones set area = 'front'
  where area is null and slug in ('front-house-beds','front-street-beds','triangle');
update zones set area = 'south'
  where area is null and slug in ('driveway','the-field','field-bed-vines');
