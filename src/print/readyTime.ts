/**
 * When the food will be ready — a range, from the order itself.
 *
 * The owner's rule (2026-09-10): a big order takes longer to cook than a small
 * one, and a delivery order needs a few more minutes to be packed for a journey
 * than a pickup does to be handed over a counter.
 *
 * Two deliberate choices:
 *
 *  - **It is a range, not a single time.** A kitchen that promises 19:45 and
 *    plates at 19:47 is late; one that says 19:40–19:45 and plates at 19:47 is
 *    a minute over. The uncertainty is real and stating it is honest.
 *  - **The threshold is measured on the food, not the bill.** A 90 SAR order
 *    with a 15 SAR delivery fee is 90 SAR of cooking. Charging more for
 *    distance does not make the kitchen slower.
 *
 * Pure, and `placedAt` is an argument rather than a clock read, so the
 * roll-over cases (an order at 23:58 ready at 00:13 the next day) are testable
 * at any hour — which is exactly when nobody is looking.
 */

/** The owner's numbers. Config, not code, the day a branch disagrees. */
export interface ReadyTimeRules {
  /** Above this items total, the order counts as a big one. In halalas. */
  largeOrderThresholdMinor: number;
  smallOrderMinutes: [number, number];
  largeOrderMinutes: [number, number];
  /** Added to both ends of a delivery order: packing for a journey. */
  deliveryExtraMinutes: number;
}

export const DEFAULT_READY_TIME_RULES: ReadyTimeRules = {
  largeOrderThresholdMinor: 10000,
  smallOrderMinutes: [10, 15],
  largeOrderMinutes: [20, 25],
  deliveryExtraMinutes: 5,
};

export interface ReadyWindow {
  fromMinutes: number;
  toMinutes: number;
  /** The clock times, `HH:MM`, in the machine's own timezone. */
  fromClock: string;
  toClock: string;
}

function clock(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/**
 * The window in which the food should be ready.
 *
 * Returns null for an unreadable placement time rather than inventing one —
 * a made-up "ready by" is a promise to a customer that nothing stands behind.
 */
export function readyWindow(
  placedAtIso: string,
  itemsTotalMinor: number,
  type: 'DELIVERY' | 'PICKUP',
  rules: ReadyTimeRules = DEFAULT_READY_TIME_RULES,
): ReadyWindow | null {
  const placed = new Date(placedAtIso);
  if (Number.isNaN(placed.getTime())) {
    return null;
  }

  const base =
    itemsTotalMinor > rules.largeOrderThresholdMinor ? rules.largeOrderMinutes : rules.smallOrderMinutes;
  const extra = type === 'DELIVERY' ? rules.deliveryExtraMinutes : 0;
  const fromMinutes = base[0] + extra;
  const toMinutes = base[1] + extra;

  return {
    fromMinutes,
    toMinutes,
    fromClock: clock(new Date(placed.getTime() + fromMinutes * 60_000)),
    toClock: clock(new Date(placed.getTime() + toMinutes * 60_000)),
  };
}
