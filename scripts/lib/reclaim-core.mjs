/**
 * Pure decision logic for the storage reclaim, kept out of the script so it can
 * be tested without a Supabase client — same split as `import-core.mjs` and
 * `area-rerun-core.mjs`.
 */

/**
 * Orphans are a byproduct of skipped uploads, so a healthy bucket has a handful.
 * A share anywhere near the library size means path matching broke — a leading
 * slash, a changed prefix, a short `zone_photos` page — and every live photo is
 * about to be read as garbage.
 *
 * This is the last line of defence before an irreversible mass delete, so it
 * fails closed: unrecognisable counts abort rather than proceed.
 */
export const ORPHAN_SHARE_LIMIT = 0.2;

export function checkOrphanShare({ orphanCount, totalObjects, limit = ORPHAN_SHARE_LIMIT, force = false }) {
  if (!Number.isFinite(orphanCount) || !Number.isFinite(totalObjects) || orphanCount < 0 || totalObjects < 0) {
    return { ok: false, share: null, reason: "could not determine orphan share" };
  }
  if (totalObjects === 0 || orphanCount === 0) return { ok: true, share: 0, forced: false };

  const share = orphanCount / totalObjects;
  if (share <= limit) return { ok: true, share, forced: false };
  if (force) return { ok: true, share, forced: true };

  return {
    ok: false,
    share,
    reason:
      `${orphanCount} of ${totalObjects} objects (${(share * 100).toFixed(1)}%) look orphaned, ` +
      `above the ${(limit * 100).toFixed(0)}% ceiling. That usually means storage paths stopped ` +
      `matching zone_photos.storage_path rather than that the photos are junk. Verify a few of ` +
      `the paths below against the table before re-running with --force.`,
  };
}
