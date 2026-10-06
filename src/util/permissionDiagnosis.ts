/**
 * Turning "You do not have permission to perform this action" into something a
 * branch can act on.
 *
 * The backend deliberately refuses to say *which* permission was missing — that
 * would map out the permission model for anyone probing the API — and it is
 * right not to. The cost is a banner on a counter terminal that names no cause,
 * no account and no remedy, so the only way to find out what is wrong is for
 * someone with database access to go and look.
 *
 * The POS does not need the server to tell it: `/auth/me` already returns this
 * account's roles and its full permission set, and the permissions each screen
 * needs are known here. Comparing the two locally says either "this account is
 * missing orders:kitchen" — which an owner fixes in Admin → Users in a minute —
 * or "this account holds everything this screen needs", which is a different
 * problem and worth knowing just as quickly.
 *
 * This leaks nothing: it is the signed-in account's own permission list, which
 * the server already handed to this client.
 */

/** What the server requires for each part of the POS. Mirrors the controllers. */
export const SCREEN_PERMISSIONS = {
  /**
   * New orders + kitchen queue, and the accept/reject/advance buttons on them.
   *
   * The board also reads `/deliveries` and assigns a driver from a ready
   * delivery card, but those are deliberately **not** listed here. That request
   * fails soft — the card falls back to the "awaiting driver" pill and the
   * queues are unaffected — so it never raises this banner, and naming its
   * permissions here would make a genuine `orders:kitchen` refusal report
   * `deliveries:assign` as the cause. See `deliveries` below for the screen
   * where those permissions are actually load-bearing.
   */
  board: ['orders:kitchen'],
  /** Order lookup, and opening one order. */
  lookup: ['orders:read'],
  /** Taking a counter order. */
  newOrder: ['orders:write', 'menu:read'],
  /** The branch's deliveries, and assigning a driver. */
  deliveries: ['deliveries:read', 'deliveries:assign', 'drivers:read'],
  /** Marking something sold out. */
  availability: ['menu:availability'],
  /**
   * The receipt preview.
   *
   * Reading the template only. Editing the branch's two overridable fields
   * needs `receipt-template:branch`, which KITCHEN does not hold — that is not
   * listed here because it is gated on the control rather than the screen, so
   * an account without it sees the preview and no Save button.
   */
  receipt: ['receipt-template:read'],
  /**
   * The branch's own reports.
   *
   * `reports:read` was granted to KITCHEN on the owner's instruction (see the
   * backend's `prisma/seed/permissions.ts`) — it is the one financial code that
   * role holds. Listing it here is what turns the 403 an older backend still
   * answers with into "this account is missing reports:read" rather than a
   * banner naming no cause: a POS bundle outlives the deploy that widened the
   * role, and the counter meets that gap, not whoever shipped it.
   */
  reports: ['reports:read'],
} as const;

export type ScreenKey = keyof typeof SCREEN_PERMISSIONS;

export interface ForbiddenDiagnosis {
  /** Permissions this screen needs that the signed-in account does not hold. */
  missing: string[];
  /**
   * True when the account holds everything the screen needs and the server
   * refused anyway — a different fault (a role changed on the server since this
   * page loaded, or a request this screen makes that is not listed here), and
   * one that a re-assignment in the admin panel will not fix.
   */
  unexplained: boolean;
}

/**
 * Compares what a screen needs against what the signed-in account holds.
 *
 * An actor with no permission list at all (still loading, or `/auth/me` failed)
 * is reported as `unexplained` rather than as missing everything — claiming a
 * permission is missing when we simply have not read the list yet would send an
 * owner to change a role that was never wrong.
 */
export function diagnoseForbidden(
  screen: ScreenKey,
  permissions: readonly string[] | null | undefined,
): ForbiddenDiagnosis {
  if (!permissions) {
    return { missing: [], unexplained: true };
  }

  const held = new Set(permissions);
  const missing = SCREEN_PERMISSIONS[screen].filter((code) => !held.has(code));

  return { missing, unexplained: missing.length === 0 };
}
