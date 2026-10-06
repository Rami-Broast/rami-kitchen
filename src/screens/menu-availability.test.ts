import { describe, expect, it } from 'vitest';

import { BranchMenu, MenuProduct } from '../api/types';
import { applyAvailability } from './MenuAvailabilityScreen';

function product(id: string, isAvailable: boolean): MenuProduct {
  return {
    id,
    name: `Product ${id}`,
    nameAr: null,
    description: null,
    priceMinor: 1500,
    isAvailable,
    variants: [],
    modifierGroups: [],
  };
}

const menu: BranchMenu = {
  branch: { id: 'b1', name: 'Olaya', nameAr: null },
  deliveryFeeMinor: 0,
  minOrderMinor: 0,
  categories: [
    { id: 'c1', name: 'Grills', nameAr: null, products: [product('p1', true), product('p2', true)] },
    { id: 'c2', name: 'Sides', nameAr: null, products: [product('p3', false)] },
  ],
};

describe('applyAvailability', () => {
  it('marks one product sold out and leaves every other alone', () => {
    const next = applyAvailability(menu, 'p1', false);

    const flat = next.categories.flatMap((c) => c.products);
    expect(flat.find((p) => p.id === 'p1')?.isAvailable).toBe(false);
    expect(flat.find((p) => p.id === 'p2')?.isAvailable).toBe(true);
    expect(flat.find((p) => p.id === 'p3')?.isAvailable).toBe(false);
  });

  it('puts a sold-out product back on across categories', () => {
    const next = applyAvailability(menu, 'p3', true);

    expect(next.categories.flatMap((c) => c.products).find((p) => p.id === 'p3')?.isAvailable).toBe(
      true,
    );
  });

  it('does not mutate the menu it was given, so a rollback restores the original', () => {
    const before = JSON.stringify(menu);
    applyAvailability(menu, 'p1', false);

    expect(JSON.stringify(menu)).toBe(before);
  });

  it('round-trips: toggling off then on is the state we started from', () => {
    // Compared by meaning rather than by serialised bytes: the function now
    // also carries a sold-out window, so a product it has touched gains an
    // explicit `unavailableUntil: null` that an untouched one does not have.
    // That is the same state written two ways, and a byte comparison would
    // fail on it while telling us nothing about whether the round-trip works.
    const off = applyAvailability(menu, 'p1', false, '2026-09-04T18:00:00.000Z');
    const backOn = applyAvailability(off, 'p1', true);

    const p1 = backOn.categories.flatMap((c) => c.products).find((p) => p.id === 'p1');
    expect(p1?.isAvailable).toBe(true);
    // Clearing the window matters more than it looks: the backend lets a window
    // outrank the flag, so a stale one would keep the item off after someone
    // had switched it back on.
    expect(p1?.unavailableUntil ?? null).toBeNull();

    // Every other product is untouched.
    expect(JSON.stringify(backOn.categories[1])).toBe(JSON.stringify(menu.categories[1]));
  });

  it('records the sold-out window it was given', () => {
    const off = applyAvailability(menu, 'p1', false, '2026-09-04T18:00:00.000Z');
    const p1 = off.categories.flatMap((c) => c.products).find((p) => p.id === 'p1');

    expect(p1?.isAvailable).toBe(false);
    expect(p1?.unavailableUntil).toBe('2026-09-04T18:00:00.000Z');
  });

  it('is a no-op for a product id the menu does not contain', () => {
    expect(JSON.stringify(applyAvailability(menu, 'nope', false))).toBe(JSON.stringify(menu));
  });
});
