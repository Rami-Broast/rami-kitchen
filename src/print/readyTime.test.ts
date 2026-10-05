import { describe, expect, it } from 'vitest';

import { DEFAULT_READY_TIME_RULES, readyWindow } from './readyTime';

/** 19:30 local, whatever the machine's timezone is. */
function placedAt(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

describe('readyWindow', () => {
  it('gives a small pickup order the short window', () => {
    const w = readyWindow(placedAt(19, 30), 8000, 'PICKUP');
    expect(w).not.toBeNull();
    expect([w?.fromClock, w?.toClock]).toEqual(['19:40', '19:45']);
  });

  it('gives a large order the long window', () => {
    const w = readyWindow(placedAt(19, 30), 15000, 'PICKUP');
    expect([w?.fromClock, w?.toClock]).toEqual(['19:50', '19:55']);
  });

  it('adds the packing minutes to a delivery, at both ends', () => {
    const w = readyWindow(placedAt(19, 30), 15000, 'DELIVERY');
    expect([w?.fromClock, w?.toClock]).toEqual(['19:55', '20:00']);
  });

  it('measures the threshold on the food, not the bill', () => {
    // Exactly at the threshold is still a small order: the rule is "above".
    // A 100 SAR basket that becomes 115 with a delivery fee has not become
    // slower to cook, which is why the caller passes the items total.
    const at = readyWindow(placedAt(12, 0), DEFAULT_READY_TIME_RULES.largeOrderThresholdMinor, 'PICKUP');
    const above = readyWindow(placedAt(12, 0), DEFAULT_READY_TIME_RULES.largeOrderThresholdMinor + 1, 'PICKUP');

    expect(at?.toMinutes).toBe(15);
    expect(above?.toMinutes).toBe(25);
  });

  it('crosses midnight without wrapping the arithmetic', () => {
    const w = readyWindow(placedAt(23, 58), 15000, 'DELIVERY');
    expect([w?.fromClock, w?.toClock]).toEqual(['00:23', '00:28']);
  });

  it('promises nothing when the placement time cannot be read', () => {
    // A made-up "ready by" is a promise to a customer that nothing stands
    // behind, so an unreadable timestamp prints no line at all.
    expect(readyWindow('not a date', 8000, 'PICKUP')).toBeNull();
  });
});
