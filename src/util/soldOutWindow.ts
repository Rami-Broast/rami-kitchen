/**
 * How long an item is off the menu.
 *
 * ## Why "until I switch it back" is not the only option
 *
 * A branch that has to remember to switch every sold-out item back on will not.
 * Service ends, the shift changes, and the item is still off tomorrow morning —
 * the menu quietly shrinks over a week and nobody can say when it happened.
 *
 * So the counter picks a window, and the backend restores the item on its own
 * when the window passes (`unavailableUntil`; see `isProductAvailable` in the
 * backend). "Until I switch it back" stays available for the genuine case —
 * the supplier failed, it is off until further notice — but it is a choice
 * rather than the only behaviour.
 *
 * Pure so the arithmetic is testable without a clock, a component or a server:
 * "rest of today" at 23:50 is the kind of thing that is wrong exactly once a
 * day and never while anyone is looking.
 */

export type SoldOutDuration = 'ONE_HOUR' | 'TWO_HOURS' | 'REST_OF_DAY' | 'INDEFINITE';

export interface SoldOutOption {
  duration: SoldOutDuration;
  /** i18n key for the button label. */
  labelKey: string;
}

export const SOLD_OUT_OPTIONS: SoldOutOption[] = [
  { duration: 'ONE_HOUR', labelKey: 'soldOutOneHour' },
  { duration: 'TWO_HOURS', labelKey: 'soldOutTwoHours' },
  { duration: 'REST_OF_DAY', labelKey: 'soldOutRestOfDay' },
  { duration: 'INDEFINITE', labelKey: 'soldOutIndefinite' },
];

/**
 * The instant a sold-out window ends, as an ISO-8601 string, or null for
 * "until someone switches it back".
 *
 * `REST_OF_DAY` means the end of the local day — the counter's day, which is
 * the one the person pressing the button is living in. At 23:50 that is ten
 * minutes away, not twenty-four hours: an item marked off "for the rest of
 * today" late at night must be back for tomorrow's service, and computing it
 * as "now + 24h" would keep it off through the whole of the next day.
 */
export function soldOutUntil(duration: SoldOutDuration, now: Date = new Date()): string | null {
  switch (duration) {
    case 'ONE_HOUR':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case 'TWO_HOURS':
      return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    case 'REST_OF_DAY': {
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay.toISOString();
    }
    case 'INDEFINITE':
      return null;
  }
}

/**
 * How a sold-out item's return reads on the card.
 *
 * Returns null when there is no window, so the caller shows nothing rather
 * than "back at null" — the state where a supplier has failed and nobody has
 * promised a time is a real one, and inventing a time for it is worse than
 * saying nothing.
 */
export function describeReturn(
  unavailableUntil: string | null | undefined,
  now: Date = new Date(),
): { minutes: number; sameDay: boolean } | null {
  if (!unavailableUntil) {
    return null;
  }

  const until = new Date(unavailableUntil);

  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
    return null;
  }

  return {
    minutes: Math.ceil((until.getTime() - now.getTime()) / 60000),
    sameDay: until.getDate() === now.getDate() && until.getMonth() === now.getMonth(),
  };
}
