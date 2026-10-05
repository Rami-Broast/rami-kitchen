/**
 * How the counter reads the list of drivers it can hand a delivery to.
 *
 * Pure, and deliberately a near-copy of `admin-app/src/util/driverPicker.ts`:
 * the owner's Deliveries page and this counter dialog are two views of one
 * dispatch decision, and the ordering and the wording must agree between them
 * or the same fleet reads differently depending on which screen you are at.
 */

export interface AssignableDriver {
  id: string;
  isOnline: boolean;
  isAvailable: boolean;
  /** Absent on a backend that predates the count; treat as unknown, not zero. */
  activeDeliveryCount?: number;
  user: { fullName: string | null };
}

/** How many jobs the driver holds, as far as this client can tell. */
export function loadOf(driver: AssignableDriver): number | null {
  if (typeof driver.activeDeliveryCount === 'number') {
    return driver.activeDeliveryCount;
  }
  // An older backend sends only the flag. "Not free" means at least one job;
  // inventing a count would be worse than saying "on a job".
  return driver.isAvailable ? 0 : null;
}

/**
 * Free drivers first, then the lightest load, then alphabetically.
 *
 * The order somebody would choose in anyway, made the default so the obvious
 * choice is at the top — during service nobody reads twelve names looking for
 * the least busy one. The name tiebreak is not cosmetic: without it the list
 * reshuffles on every eight-second poll and the row under your finger moves.
 */
export function sortByAvailability<T extends AssignableDriver>(drivers: readonly T[]): T[] {
  return [...drivers].sort((a, b) => {
    if (a.isAvailable !== b.isAvailable) {
      return a.isAvailable ? -1 : 1;
    }
    const la = loadOf(a) ?? Number.MAX_SAFE_INTEGER;
    const lb = loadOf(b) ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) {
      return la - lb;
    }
    return (a.user.fullName ?? '').localeCompare(b.user.fullName ?? '');
  });
}

/** The i18n key and count for a driver's load, so the caller can translate it. */
export function loadKey(driver: AssignableDriver): {
  key: 'driverFree' | 'driverOnAJob' | 'driverCarryingOne' | 'driverCarryingMany';
  count: number;
} {
  const load = loadOf(driver);
  if (load === null) {
    return { key: 'driverOnAJob', count: 1 };
  }
  if (load === 0) {
    return { key: 'driverFree', count: 0 };
  }
  return load === 1
    ? { key: 'driverCarryingOne', count: 1 }
    : { key: 'driverCarryingMany', count: load };
}
