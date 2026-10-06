/**
 * The bare amount — no currency word. For a column of figures (a printed
 * ticket, a table) where repeating "SAR" on every row spends characters the
 * narrow roll does not have and tells the reader nothing new.
 */
export function formatAmount(amountMinor: number): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  const body = `${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
  return `${amountMinor < 0 ? '-' : ''}${body}`;
}

/** Money formatting — integer minor units (halalas), SAR. The POS displays; it never prices. */
export function formatSar(amountMinor: number): string {
  return `SAR ${formatAmount(amountMinor)}`;
}

/** Minutes elapsed since an ISO timestamp (never negative). */
export function minutesSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - then) / 60000));
}
