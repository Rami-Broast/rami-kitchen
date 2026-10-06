import { describe, expect, it } from 'vitest';

import { describeReturn, soldOutUntil } from './soldOutWindow';

describe('soldOutUntil', () => {
  const noon = new Date('2026-09-04T12:00:00.000Z');

  it('is an hour away for one hour', () => {
    expect(soldOutUntil('ONE_HOUR', noon)).toBe('2026-09-04T13:00:00.000Z');
  });

  it('is two hours away for two hours', () => {
    expect(soldOutUntil('TWO_HOURS', noon)).toBe('2026-09-04T14:00:00.000Z');
  });

  it('is null for "until I switch it back"', () => {
    // A real state: the supplier failed and nobody can promise a time.
    // Inventing one would be worse than having none.
    expect(soldOutUntil('INDEFINITE', noon)).toBeNull();
  });

  it('ends "rest of today" at the end of the local day, not 24 hours later', () => {
    const end = soldOutUntil('REST_OF_DAY', noon);

    expect(end).not.toBeNull();
    const parsed = new Date(end as string);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
    expect(parsed.getDate()).toBe(noon.getDate());
  });

  it('does not carry a late-night "rest of today" into tomorrow’s service', () => {
    // The bug this guards is wrong exactly once a day and never while anyone
    // is looking: computed as now + 24h, an item marked off at 23:50 would
    // stay off through the whole of the next day.
    const lateLocal = new Date(2026, 8, 4, 23, 50, 0);
    const end = soldOutUntil('REST_OF_DAY', lateLocal);

    const parsed = new Date(end as string);
    expect(parsed.getTime() - lateLocal.getTime()).toBeLessThan(60 * 60 * 1000);
    expect(parsed.getDate()).toBe(lateLocal.getDate());
  });
});

describe('describeReturn', () => {
  const noon = new Date('2026-09-04T12:00:00.000Z');

  it('says nothing when there is no window', () => {
    expect(describeReturn(null, noon)).toBeNull();
    expect(describeReturn(undefined, noon)).toBeNull();
  });

  it('says nothing once the window has already passed', () => {
    // The backend has already put the item back; a card still counting down
    // would be describing a state that no longer exists.
    expect(describeReturn('2026-09-04T11:00:00.000Z', noon)).toBeNull();
  });

  it('says nothing for a window that is not a date', () => {
    expect(describeReturn('this evening', noon)).toBeNull();
  });

  it('counts the minutes until it returns', () => {
    expect(describeReturn('2026-09-04T13:30:00.000Z', noon)?.minutes).toBe(90);
  });

  it('rounds a part-minute up, so it never reads "back in 0 minutes"', () => {
    expect(describeReturn('2026-09-04T12:00:30.000Z', noon)?.minutes).toBe(1);
  });
});
