/**
 * The order the Receipt screen previews.
 *
 * Deliberately awkward rather than tidy, and kept in step with
 * `admin-app/src/print/docket/sample.ts` for the same reason the builders are:
 * the owner and the branch must be looking at the same document. A first-time
 * customer, an item with a note and add-ons, a dish name long enough to wrap on
 * a 58mm roll, a promotion **and** a coupon stacked, a platform fee, and a
 * delivery. A branch that only ever previews a two-item pickup has not seen
 * what most of its receipts look like.
 *
 * `now` is an argument rather than read off the clock so the preview is stable
 * under test — the ready-time window is computed from the placement time, and a
 * fixture that moves cannot be asserted against.
 */
import { KitchenOrder } from '../api/types';

export function sampleDocketOrder(now: Date = new Date()): KitchenOrder {
  const placedAt = new Date(now);
  placedAt.setHours(19, 30, 0, 0);

  return {
    id: 'preview',
    orderNumber: '1000042',
    referenceId: '481903772651',
    type: 'DELIVERY',
    status: 'PREPARING',
    currency: 'SAR',
    paymentStatus: 'PAID',
    placedAt: placedAt.toISOString(),
    customerNotes: 'Ring the top bell — the gate code is 4417.',
    items: [
      {
        id: 'i1',
        productName: 'Charcoal grilled chicken with garlic sauce',
        variantName: 'Full',
        quantity: 1,
        lineSubtotalMinor: 6100,
        lineTotalMinor: 5700,
        notes: 'Cut into quarters, wrap the bread separately',
        modifiers: [
          { id: 'm1', addonName: 'Extra rice', quantity: 1 },
          { id: 'm2', addonName: 'Garlic sauce', quantity: 2 },
        ],
      },
      {
        id: 'i2',
        productName: 'Chicken Shawarma Wrap',
        variantName: null,
        quantity: 3,
        lineSubtotalMinor: 7350,
        lineTotalMinor: 6900,
        modifiers: [{ id: 'm3', addonName: 'Cheese', quantity: 1 }],
      },
      {
        id: 'i3',
        productName: 'Fresh Orange Juice',
        variantName: 'Large',
        quantity: 2,
        lineSubtotalMinor: 2800,
        lineTotalMinor: 2800,
      },
    ],
    branch: { id: 'b1', code: 'OLY', name: 'Olaya Branch', nameAr: 'فرع العليا' },
    customer: { id: 'c1', phone: '+966501234567', fullName: 'Fatimah A.', _count: { orders: 1 } },
    subtotalMinor: 16250,
    discountMinor: 1000,
    deliveryFeeMinor: 800,
    chargesMinor: 200,
    orderCharges: [{ id: 'ch1', name: 'Platform fee', totalMinor: 200 }],
    vatMinor: 2124,
    vatRate: '0.1500',
    totalMinor: 16250 + 800 + 200 - 1000,
    promotion: { id: 'p1', name: '10% off wraps' },
    coupon: { id: 'cp1', code: 'WELCOME5', name: null },
    discounts: [
      { id: 'd1', kind: 'PROMOTION', label: '10% off wraps', amountMinor: 600 },
      { id: 'd2', kind: 'COUPON', label: 'WELCOME5', amountMinor: 400 },
    ],
  };
}
