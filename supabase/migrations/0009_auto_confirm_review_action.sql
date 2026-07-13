-- Allow a fourth review_action, 'auto_confirmed', for photos confirmed in bulk by
-- the high-confidence auto-assign pass (AI suggestion accepted without a human
-- click). Kept distinct from 'confirmed_asis' (a human clicked "Confirm all
-- correct") so the machine-confirmed set stays auditable and reversible in one
-- query. Idempotent — drops and re-adds the check.

alter table zone_photos drop constraint if exists zone_photos_review_action_check;
alter table zone_photos add constraint zone_photos_review_action_check
  check (
    review_action is null
    or review_action in ('confirmed_asis', 'reassigned', 'rejected', 'auto_confirmed')
  );
