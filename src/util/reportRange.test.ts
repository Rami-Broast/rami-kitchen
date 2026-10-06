import { describe, expect, it } from 'vitest';

import {
  DayRange,
  dayKey,
  daysInRange,
  isDay,
  isUsableRange,
  matchingPreset,
  presetRange,
  windowFor,
} from './reportRange';

/** Local midnight and the last millisecond of a local day, as instants. */
function localStart(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
function localEnd(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

describe('dayKey', () => {
  it('is the local calendar day, not the UTC one', () => {
    // 23:30 local on the 11th. In any timezone ahead of UTC this instant is
    // already the 12th in UTC, and a report for "the 11th" built off the UTC
    // day would miss the whole evening.
    const late = new Date(2026, 8, 11, 23, 30, 0);
    expect(dayKey(late)).toBe('2026-09-11');
  });

  it('pads a single-digit month and day', () => {
    expect(dayKey(new Date(2026, 0, 5, 10, 0, 0))).toBe('2026-01-05');
  });
});

describe('isDay', () => {
  it('accepts a real calendar day', () => {
    expect(isDay('2026-09-12')).toBe(true);
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    // `new Date(2026, 1, 30)` is the 2nd of March. Accepting it would report on
    // a day nobody asked about.
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-00-10')).toBe(false);
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(isDay('')).toBe(false);
    expect(isDay('12/09/2026')).toBe(false);
    expect(isDay('2026-9-1')).toBe(false);
  });
});

describe('windowFor', () => {
  it('spans local midnight to the last millisecond of the end day', () => {
    expect(windowFor({ fromDay: '2026-09-12', toDay: '2026-09-12' })).toEqual({
      from: localStart(2026, 9, 12),
      to: localEnd(2026, 9, 12),
    });
  });

  it('never reaches into the next day, because the backend filter is inclusive', () => {
    // `lte` on the server: the next day's 00:00:00.000 would count an order
    // placed in that millisecond in both reports.
    const w = windowFor({ fromDay: '2026-09-12', toDay: '2026-09-12' });
    expect(w?.to).not.toBe(localStart(2026, 9, 13));
  });

  it('covers a multi-day range end to end', () => {
    expect(windowFor({ fromDay: '2026-09-01', toDay: '2026-09-30' })).toEqual({
      from: localStart(2026, 9, 1),
      to: localEnd(2026, 9, 30),
    });
  });

  it('produces a window the backend accepts for a single day', () => {
    // The server refuses `to <= from`. A one-day range is the commonest one, so
    // this is the assertion that the commonest request is not a 400.
    const w = windowFor({ fromDay: '2026-09-12', toDay: '2026-09-12' });
    expect(new Date(w!.to).getTime()).toBeGreaterThan(new Date(w!.from).getTime());
  });

  it('is null for a half-typed or impossible range instead of throwing', () => {
    // `new Date(NaN).toISOString()` throws, and this runs on every keystroke in
    // a date box — a throw here is a blank screen at the counter.
    expect(windowFor({ fromDay: '2026-09', toDay: '2026-09-12' })).toBeNull();
    expect(windowFor({ fromDay: '', toDay: '' })).toBeNull();
    expect(windowFor({ fromDay: '2026-09-20', toDay: '2026-09-12' })).toBeNull();
  });
});

describe('isUsableRange', () => {
  it('accepts a single day and an ordered range', () => {
    expect(isUsableRange({ fromDay: '2026-09-12', toDay: '2026-09-12' })).toBe(true);
    expect(isUsableRange({ fromDay: '2026-09-01', toDay: '2026-09-12' })).toBe(true);
  });

  it('refuses a range that runs backwards', () => {
    expect(isUsableRange({ fromDay: '2026-09-12', toDay: '2026-09-01' })).toBe(false);
  });
});

describe('presetRange', () => {
  const now = new Date(2026, 8, 12, 14, 30, 0); // Sat 12 Sep 2026, local

  it('today is one day', () => {
    expect(presetRange('today', now)).toEqual({ fromDay: '2026-09-12', toDay: '2026-09-12' });
  });

  it('yesterday is one day, the day before', () => {
    expect(presetRange('yesterday', now)).toEqual({
      fromDay: '2026-09-11',
      toDay: '2026-09-11',
    });
  });

  it('last 7 days includes today, so it is six days back and not seven', () => {
    expect(presetRange('last7', now)).toEqual({ fromDay: '2026-09-06', toDay: '2026-09-12' });
    expect(daysInRange(presetRange('last7', now))).toBe(7);
  });

  it('this month is month-to-date, not the last 30 days', () => {
    expect(presetRange('thisMonth', now)).toEqual({
      fromDay: '2026-09-01',
      toDay: '2026-09-12',
    });
  });

  it('steps the calendar across a month boundary', () => {
    const firstOfMonth = new Date(2026, 8, 1, 0, 5, 0);
    expect(presetRange('yesterday', firstOfMonth)).toEqual({
      fromDay: '2026-08-31',
      toDay: '2026-08-31',
    });
    // Six steps back from the 1st, inclusive of the 1st itself.
    expect(presetRange('last7', firstOfMonth).fromDay).toBe('2026-08-26');
    // Month-to-date on the 1st is just the 1st, not a range running backwards.
    expect(presetRange('thisMonth', firstOfMonth)).toEqual({
      fromDay: '2026-09-01',
      toDay: '2026-09-01',
    });
  });

  it('is right at five to midnight, which is when a day-boundary bug shows', () => {
    const late = new Date(2026, 8, 12, 23, 55, 0);
    expect(presetRange('today', late)).toEqual({ fromDay: '2026-09-12', toDay: '2026-09-12' });
    expect(presetRange('yesterday', late)).toEqual({
      fromDay: '2026-09-11',
      toDay: '2026-09-11',
    });
  });

  it('steps the calendar across a year boundary', () => {
    const newYear = new Date(2027, 0, 1, 1, 0, 0);
    expect(presetRange('yesterday', newYear)).toEqual({
      fromDay: '2026-12-31',
      toDay: '2026-12-31',
    });
  });

  it('every preset produces a usable range', () => {
    for (const preset of ['today', 'yesterday', 'last7', 'thisMonth'] as const) {
      expect(isUsableRange(presetRange(preset, now))).toBe(true);
    }
  });
});

describe('matchingPreset', () => {
  const now = new Date(2026, 8, 12, 14, 30, 0);

  it('recognises each preset from the range alone', () => {
    for (const preset of ['today', 'yesterday', 'last7', 'thisMonth'] as const) {
      expect(matchingPreset(presetRange(preset, now), now)).toBe(preset);
    }
  });

  it('is null for a hand-picked range', () => {
    expect(matchingPreset({ fromDay: '2026-07-03', toDay: '2026-07-09' }, now)).toBeNull();
  });

  it('stops calling a stale range "today" once the day has turned', () => {
    // A terminal left open through a shift change. The highlight is derived
    // rather than remembered precisely so it cannot say "Today" over
    // yesterday's figures.
    const yesterdaysToday: DayRange = presetRange('today', new Date(2026, 8, 11, 22, 0, 0));
    expect(matchingPreset(yesterdaysToday, now)).toBe('yesterday');
  });
});

describe('daysInRange', () => {
  it('counts inclusively', () => {
    expect(daysInRange({ fromDay: '2026-09-12', toDay: '2026-09-12' })).toBe(1);
    expect(daysInRange({ fromDay: '2026-09-01', toDay: '2026-09-30' })).toBe(30);
  });

  it('is null for an unusable range', () => {
    expect(daysInRange({ fromDay: 'x', toDay: '2026-09-12' })).toBeNull();
  });
});
