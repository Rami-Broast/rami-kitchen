/**
 * The reporting window, and the one thing about it that is easy to get wrong.
 *
 * The backend windows every report on `placedAt` between two **UTC instants**,
 * inclusive (`src/reports/reports.service.ts`). What a counter means by "today"
 * is not a UTC day: Riyadh runs at UTC+3, so UTC midnight is 03:00 local, and a
 * window built from the UTC day would put the first three hours of the branch's
 * own morning into yesterday's sheet and leave the last three hours of the
 * evening out of tonight's. Nobody at the counter would see that — the totals
 * would simply be wrong by however much trade falls either side of 03:00, every
 * single day, and the only symptom is a figure that does not match the till.
 *
 * So a range is chosen here as **local days** and converted to instants at the
 * boundary. That is also the unit the person asking has in mind: a cashier
 * picks "today", not "the 21 hours since 03:00".
 *
 * Pure, and `now` is always an argument. A function that reads the clock cannot
 * be tested at 23:55 — which is exactly when a day-boundary bug shows and
 * nobody is looking. Same rule as `soldOutWindow.ts`.
 */

/** The presets the screen offers, in the order it offers them. */
export type RangePresetId = 'today' | 'yesterday' | 'last7' | 'thisMonth';

export const RANGE_PRESETS: RangePresetId[] = ['today', 'yesterday', 'last7', 'thisMonth'];

/**
 * A range as the screen holds it: two local calendar days, `YYYY-MM-DD`.
 *
 * Held as day strings rather than instants because that is what a
 * `<input type="date">` reads and writes, and because a range the user is
 * halfway through editing has to survive being invalid.
 */
export interface DayRange {
  fromDay: string;
  toDay: string;
}

/** The window as the API takes it: two ISO-8601 UTC instants, inclusive. */
export interface ReportWindow {
  from: string;
  to: string;
}

/** A local calendar day as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses `YYYY-MM-DD` into its parts, or null if it is not one. */
function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  // Round-trip through a Date so 2026-02-30 is refused rather than silently
  // becoming the 2nd of March — a range nobody typed, reporting on a day that
  // does not exist.
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** True if a day string is a real calendar day this module can use. */
export function isDay(day: string): boolean {
  return parseDay(day) !== null;
}

/**
 * A range is usable when both ends are real days and the first is not after the
 * second.
 *
 * A single day is a valid range — it is the commonest one — because the window
 * it produces spans that day's own midnight to its last millisecond, which the
 * backend accepts (it refuses only `to <= from`).
 */
export function isUsableRange(range: DayRange): boolean {
  const from = parseDay(range.fromDay);
  const to = parseDay(range.toDay);
  if (!from || !to) {
    return false;
  }
  return `${range.fromDay}` <= `${range.toDay}`;
}

/**
 * Turns two local days into the inclusive UTC window the API takes.
 *
 * The end is the last millisecond of `toDay`, local. Not the next day's
 * midnight: the backend's filter is `lte`, so `00:00:00.000` of the following
 * day would pull in any order placed in that exact millisecond — which is
 * nothing most nights and one order on the night it matters, counted twice
 * across two reports that are then each wrong and disagree with each other.
 *
 * Returns null for a range that is not usable, rather than a window built from
 * `NaN` — `new Date(NaN).toISOString()` throws, and the screen would blank on a
 * half-typed date.
 */
export function windowFor(range: DayRange): ReportWindow | null {
  const from = parseDay(range.fromDay);
  const to = parseDay(range.toDay);
  if (!from || !to || !isUsableRange(range)) {
    return null;
  }
  const start = new Date(from.y, from.m - 1, from.d, 0, 0, 0, 0);
  const end = new Date(to.y, to.m - 1, to.d, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** The day range a preset means, relative to a local `now`. */
export function presetRange(preset: RangePresetId, now: Date): DayRange {
  const today = dayKey(now);

  if (preset === 'today') {
    return { fromDay: today, toDay: today };
  }

  if (preset === 'yesterday') {
    // Built by stepping the date rather than subtracting 24 hours: on the two
    // days a year a timezone shifts, "now minus 86,400,000 ms" is 23:00 or
    // 01:00 of the wrong day. `setDate` is the calendar operation, and the
    // calendar is what "yesterday" means.
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const day = dayKey(d);
    return { fromDay: day, toDay: day };
  }

  if (preset === 'last7') {
    // Seven days **including today**, which is what somebody picking "last 7
    // days" on a Sunday evening is asking about. Six steps back, not seven.
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { fromDay: dayKey(d), toDay: today };
  }

  // This calendar month so far — not the last 30 days. A month-to-date figure
  // is the one that reconciles against anything else the restaurant counts.
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { fromDay: dayKey(first), toDay: today };
}

/**
 * Which preset a range currently *is*, or null for a hand-picked one.
 *
 * The screen highlights the matching button. Deriving it from the range rather
 * than remembering which button was pressed means the highlight is still right
 * after midnight — a terminal left open through a shift change would otherwise
 * keep "Today" lit while showing yesterday's figures, which is the one state
 * where an operator reads the wrong number without any reason to doubt it.
 */
export function matchingPreset(range: DayRange, now: Date): RangePresetId | null {
  for (const preset of RANGE_PRESETS) {
    const candidate = presetRange(preset, now);
    if (candidate.fromDay === range.fromDay && candidate.toDay === range.toDay) {
      return preset;
    }
  }
  return null;
}

/** How many local days a usable range covers, inclusive. Null if unusable. */
export function daysInRange(range: DayRange): number | null {
  const from = parseDay(range.fromDay);
  const to = parseDay(range.toDay);
  if (!from || !to || !isUsableRange(range)) {
    return null;
  }
  const start = new Date(from.y, from.m - 1, from.d, 12, 0, 0, 0);
  const end = new Date(to.y, to.m - 1, to.d, 12, 0, 0, 0);
  // Midday anchors, so a daylight-saving shift inside the range cannot make the
  // difference 23 or 25 hours and round to the wrong day count.
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}
