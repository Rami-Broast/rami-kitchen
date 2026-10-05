import { describe, expect, it } from 'vitest';

import { AssignableDriver, loadKey, loadOf, sortByAvailability } from './driverPicker';
import { translate } from '../i18n/i18n';

const driver = (name: string, overrides: Partial<AssignableDriver> = {}): AssignableDriver => ({
  id: name,
  isOnline: true,
  isAvailable: true,
  activeDeliveryCount: 0,
  user: { fullName: name },
  ...overrides,
});

describe('driverPicker', () => {
  it('puts free drivers first, then the lightest load', () => {
    const ordered = sortByAvailability([
      driver('Three', { isAvailable: false, activeDeliveryCount: 3 }),
      driver('One', { isAvailable: false, activeDeliveryCount: 1 }),
      driver('Free'),
    ]);
    expect(ordered.map((d) => d.id)).toEqual(['Free', 'One', 'Three']);
  });

  it('breaks a tie by name, so the list does not reshuffle under a finger', () => {
    // The board polls every eight seconds. Without a stable tiebreak the row
    // someone is reaching for moves between renders.
    expect(sortByAvailability([driver('Zaid'), driver('Ahmed')]).map((d) => d.id)).toEqual([
      'Ahmed',
      'Zaid',
    ]);
  });

  it('treats a missing count as unknown, never as zero', () => {
    // Zero would rank a driver the server called busy above the free ones.
    const legacy = driver('Legacy', { isAvailable: false, activeDeliveryCount: undefined });
    expect(loadOf(legacy)).toBeNull();
    expect(loadKey(legacy).key).toBe('driverOnAJob');
    expect(sortByAvailability([legacy, driver('Free')]).map((d) => d.id)).toEqual([
      'Free',
      'Legacy',
    ]);
  });

  it('names the load in both languages, with the number in each language’s own place', () => {
    const two = driver('B', { isAvailable: false, activeDeliveryCount: 2 });
    const { key, count } = loadKey(two);
    expect(translate('en', key, { n: count })).toBe('Carrying 2 deliveries');
    expect(translate('ar', key, { n: count })).toContain('2');
    // A driver with nothing on says "Free", not "Carrying 0 deliveries".
    expect(loadKey(driver('Free')).key).toBe('driverFree');
  });
});
