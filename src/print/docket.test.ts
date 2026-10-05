import { describe, expect, it } from 'vitest';

import { KitchenOrder } from '../api/types';
import { DEFAULT_DOCKET_TEMPLATE, buildDocket, discountLines } from './docket';

const order: KitchenOrder = {
  id: 'o1',
  orderNumber: '1000042',
  referenceId: '482913066571',
  type: 'DELIVERY',
  status: 'CONFIRMED',
  currency: 'SAR',
  customerNotes: null,
  placedAt: new Date(new Date().setHours(19, 30, 0, 0)).toISOString(),
  items: [
    {
      id: 'i1',
      productName: 'Shawarma',
      variantName: 'Large',
      quantity: 2,
      modifiers: [{ id: 'm1', addonName: 'Extra garlic', quantity: 1 }],
      lineSubtotalMinor: 4000,
      lineTotalMinor: 3600,
      notes: 'No pickles',
    },
    { id: 'i2', productName: 'Fries', variantName: null, quantity: 1, lineSubtotalMinor: 700, lineTotalMinor: 700 },
  ],
  branch: { id: 'b1', code: 'B1', name: 'Olaya Branch', nameAr: null },
  customer: { id: 'c1', phone: '+966501234567', fullName: 'Fatimah A.', _count: { orders: 1 } },
  subtotalMinor: 4700,
  discountMinor: 400,
  deliveryFeeMinor: 800,
  chargesMinor: 200,
  orderCharges: [{ id: 'ch1', name: 'Platform fee', totalMinor: 200 }],
  vatMinor: 704,
  vatRate: '0.1500',
  totalMinor: 5300,
  promotion: { id: 'p1', name: '10% off wraps' },
};

describe('buildDocket', () => {
  it('carries the brand, the branch, the type and the order', () => {
    const d = buildDocket(order);
    expect(d).toContain('Rami Broast');
    expect(d).toContain('Olaya Branch');
    expect(d).toContain('DELIVERY');
    expect(d).toContain('Order 1000042');
    expect(d).toContain('Ref 482913066571');
  });

  it('names the customer and marks a first order', () => {
    const d = buildDocket(order);
    expect(d).toContain('Fatimah A.');
    expect(d).toContain('+966501234567');
    expect(d).toContain('New customer');
  });

  it('does not call a returning customer new', () => {
    const returning: KitchenOrder = {
      ...order,
      customer: { ...order.customer!, _count: { orders: 6 } },
    };
    expect(buildDocket(returning)).not.toContain('New customer');
  });

  it('says nothing about the customer being new when the count is unknown', () => {
    // An older backend sends no count. Unknown is not new, and calling a
    // regular customer new is the mistake that gets noticed at the counter.
    const unknown: KitchenOrder = {
      ...order,
      customer: { id: 'c1', phone: '+966501234567', fullName: 'Fatimah A.' },
    };
    expect(buildDocket(unknown)).not.toContain('New customer');
  });

  it('gives a ready window rather than a single promised minute', () => {
    // 19:30, 47 SAR of food, delivery: the short window plus the packing
    // minutes.
    expect(buildDocket(order)).toContain('Ready 19:45 - 19:50');
  });

  it('lists items at their pre-discount amount, because the discount has its own line', () => {
    const d = buildDocket(order);
    // 40.00 struck off nothing: the line is listed gross and the promotion is
    // subtracted once, below. Listing 36.00 here and subtracting 4.00 again is
    // the arithmetic error a customer always spots.
    expect(d).toContain('40.00');
    expect(d).toContain('Promotion - 10% off wraps');
    expect(d).toContain('-4.00');
  });

  it('names each charge rather than lumping them together', () => {
    expect(buildDocket(order)).toContain('Platform fee');
  });

  it("prints the backend's own total, and states the VAT as already inside it", () => {
    const d = buildDocket(order);
    expect(d).toContain('TOTAL PAID');
    expect(d).toContain('SAR 53.00');
    expect(d).toContain('Includes VAT (15%)');
    expect(d).toContain('SAR 7.04');
    // Never laid out as a tax invoice, and it says so: the restaurant issues
    // its ZATCA invoice separately.
    expect(d).toContain('Not a tax invoice');
    expect(d).not.toContain('Subtotal before VAT');
  });

  it('the printed lines reconcile with the total the backend charged', () => {
    // Items gross + delivery + charges - discount = what was paid. The docket
    // never computes the total, but if these two disagree the customer is
    // reading a receipt that does not add up.
    const reconstructed =
      (order.subtotalMinor ?? 0) +
      (order.deliveryFeeMinor ?? 0) +
      (order.chargesMinor ?? 0) -
      (order.discountMinor ?? 0);
    expect(reconstructed).toBe(order.totalMinor);
  });

  it('thanks the customer last', () => {
    const d = buildDocket(order);
    expect(d).toContain('Thank you!');
    expect(d).toContain('Please visit again.');
  });

  it('wraps to the roll at both paper widths', () => {
    for (const width of [32, 42]) {
      for (const line of buildDocket(order, width).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('prints only the sections the template lists, in the order it lists them', () => {
    // The editor's toggles and its reordering are the same mechanism: a
    // section left out of the list does not print.
    const d = buildDocket(order, 42, {
      ...DEFAULT_DOCKET_TEMPLATE,
      sections: ['thankYou', 'orderMeta'],
    });

    expect(d).not.toContain('Rami Broast');
    expect(d).not.toContain('TOTAL PAID');
    expect(d.indexOf('Thank you!')).toBeLessThan(d.indexOf('Order 1000042'));
  });
});

describe('discountLines', () => {
  it('itemises a stacked promotion and coupon from the order\u2019s own rows', () => {
    const stacked: KitchenOrder = {
      ...order,
      discountMinor: 900,
      discounts: [
        { id: 'd1', kind: 'PROMOTION', label: '10% off wraps', amountMinor: 400 },
        { id: 'd2', kind: 'COUPON', label: 'WELCOME5', amountMinor: 500 },
      ],
    };

    expect(discountLines(stacked)).toEqual([
      { label: 'Promotion - 10% off wraps', amountMinor: 400 },
      { label: 'Coupon WELCOME5', amountMinor: 500 },
    ]);
    // Both reach the paper, not just the one that happened to be first.
    const printed = buildDocket(stacked);
    expect(printed).toContain('-4.00');
    expect(printed).toContain('-5.00');
  });

  it('names a coupon by the code the customer typed', () => {
    const withCoupon: KitchenOrder = { ...order, promotion: null, coupon: { id: 'c', code: 'WELCOME10', name: null } };
    expect(discountLines(withCoupon)).toEqual([{ label: 'Coupon WELCOME10', amountMinor: 400 }]);
  });

  it('is empty when nothing was discounted, so no empty line prints', () => {
    expect(discountLines({ ...order, discountMinor: 0 })).toEqual([]);
  });
});
