import { describe, expect, it } from 'vitest';

import { KitchenOrder } from '../api/types';
import { PaymentsReport, ReportKpis, SalesReport, VatReport } from '../api/types';
import { buildDocket, buildKitchenTicket, buildSalesReportTicket } from './tickets';

const order: KitchenOrder = {
  id: 'o1',
  orderNumber: '1000042',
  referenceId: '482913066571',
  type: 'PICKUP',
  status: 'CONFIRMED',
  totalMinor: 4500,
  currency: 'SAR',
  customerNotes: 'No onions',
  placedAt: '2026-08-23T10:00:00.000Z',
  items: [
    {
      id: 'i1',
      productName: 'Shawarma',
      variantName: 'Large',
      quantity: 2,
      modifiers: [{ id: 'm1', addonName: 'Extra garlic', quantity: 1 }],
      unitPriceMinor: 1750,
      lineTotalMinor: 3800,
      notes: 'No pickles',
    },
    { id: 'i2', productName: 'Fries', variantName: null, quantity: 1, unitPriceMinor: 700, lineTotalMinor: 700 },
  ],
  branch: { id: 'b1', code: 'B1', name: 'Olaya', nameAr: null },
};

describe('buildKitchenTicket', () => {
  it('carries the branch, the order number, the items and what the food comes to', () => {
    const t = buildKitchenTicket(order);
    expect(t).toContain('Olaya');
    expect(t).toContain('Order 1000042');
    // A pickup is bagged for a counter; a delivery is packed for a journey.
    expect(t).toContain('PICKUP');
    expect(t).toContain('Shawarma (Large)');
    expect(t).toContain('+ Extra garlic');
    expect(t).toContain('Thank you!');
    expect(t).not.toMatch(/invoice/i);
  });

  it('prints the placing time to the second, day first', () => {
    // Fixed format rather than the counter machine's locale: a month-first
    // render is a different date to the branch reading it, and nothing on the
    // roll says which was meant.
    const placed = new Date(order.placedAt);
    const pad = (n: number): string => String(n).padStart(2, '0');

    expect(buildKitchenTicket(order)).toContain(
      `${pad(placed.getDate())}/${pad(placed.getMonth() + 1)}/${placed.getFullYear()} ` +
        `${pad(placed.getHours())}:${pad(placed.getMinutes())}:${pad(placed.getSeconds())}`,
    );
  });

  it('prices each line and totals the items — not the order', () => {
    const t = buildKitchenTicket(order);
    expect(t).toContain('38.00');
    expect(t).toContain('7.00');
    // 38.00 + 7.00, and labelled ITEMS: the delivery fee and any charges sit
    // outside these lines, so this is not what the customer pays.
    expect(t).toContain('ITEMS TOTAL');
    expect(t).toContain('SAR 45.00');
  });

  it('prints an item note under its own item, and nothing where there is none', () => {
    const t = buildKitchenTicket(order);
    const lines = t.split('\n');
    const itemIndex = lines.findIndex((l) => l.includes('Shawarma'));
    const noteIndex = lines.findIndex((l) => l.includes('No pickles'));
    const friesIndex = lines.findIndex((l) => l.includes('Fries'));

    expect(noteIndex).toBeGreaterThan(itemIndex);
    expect(noteIndex).toBeLessThan(friesIndex);
    // The unnoted item is followed straight by the next line — no empty note
    // heading, which is a line a cook learns to skip past.
    expect(lines[friesIndex + 1]).not.toContain('**');
  });

  it('leaves the order-level note as the fallback it is, at the foot', () => {
    const t = buildKitchenTicket(order);
    expect(t).toContain('NOTE:');
    expect(t).toContain('No onions');
    expect(t.indexOf('No onions')).toBeGreaterThan(t.indexOf('Fries'));
  });

  it('prints no amount, and no items total, for a line whose price is unknown', () => {
    // An older backend sends no line total. That is unknown, never zero: a
    // 0.00 on the roll is a figure the branch cannot reconcile, and a total
    // built from one is worse.
    const unpriced: KitchenOrder = {
      ...order,
      items: order.items.map((item, index) =>
        index === order.items.length - 1 ? { ...item, lineTotalMinor: undefined } : item,
      ),
    };
    const t = buildKitchenTicket(unpriced);

    expect(t).toContain('Fries');
    expect(t).not.toContain('0.00');
    expect(t).not.toContain('ITEMS TOTAL');
  });

  it('wraps every line to the roll rather than letting the printer break it', () => {
    const wide: KitchenOrder = {
      ...order,
      customerNotes: 'Extra spicy, no onions at all, and please ring the top bell — the gate code is 4417.',
      items: order.items.map((item) => ({
        ...item,
        productName: 'Charcoal grilled chicken with garlic sauce and pickles',
        notes: 'Cut into quarters, wrap the bread separately so it does not go soft on the way',
      })),
    };

    for (const width of [32, 42]) {
      for (const line of buildKitchenTicket(wide, width).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe('the reference line', () => {
  it('is omitted rather than printed empty when the order has no reference', () => {
    const withoutReference: KitchenOrder = { ...order, referenceId: undefined };

    expect(buildDocket(withoutReference)).not.toContain('Ref');
    // The branch's own order number still prints — the docket is still usable.
    expect(buildDocket(withoutReference)).toContain('Order 1000042');
    // The kitchen ticket never carried one: it does not leave the branch, and
    // nobody quotes a reference to a cook.
    expect(buildKitchenTicket(order)).not.toContain('Ref');
  });
});

/**
 * The ticket with its line breaks and padding collapsed.
 *
 * A caveat longer than the roll is wrapped onto two or three lines, which is
 * the point of wrapping it — so a sentence has to be matched against the
 * unwrapped text. The width assertions below are what hold the wrapping itself.
 */
function unwrap(ticket: string): string {
  return ticket.split('\n').map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
}

describe('buildSalesReportTicket', () => {
  const sales: SalesReport = {
    period: { from: '2026-09-12T00:00:00.000Z', to: '2026-09-12T20:59:59.999Z' },
    currency: 'SAR',
    statusBreakdown: [
      { status: 'CANCELLED', orders: 2, totalMinor: 9000 },
      { status: 'DELIVERED', orders: 11, totalMinor: 143000 },
    ],
    realised: {
      orders: 11,
      subtotalMinor: 130000,
      discountMinor: 2500,
      deliveryFeeMinor: 5500,
      chargesMinor: 1000,
      taxableBaseMinor: 124348,
      vatMinor: 18652,
      totalMinor: 143000,
    },
    charges: [{ name: 'Service fee', count: 11, grossMinor: 870, vatMinor: 130, totalMinor: 1000 }],
  };

  const payments: PaymentsReport = {
    period: sales.period,
    currency: 'SAR',
    byStatus: [{ status: 'PAID', payments: 11, capturedMinor: 143000, refundedMinor: 2000 }],
    byMethod: [
      { method: 'CASH', payments: 7, capturedMinor: 91000, refundedMinor: 0 },
      { method: 'CASH_ON_DELIVERY', payments: 4, capturedMinor: 52000, refundedMinor: 2000 },
    ],
    totals: {
      payments: 11,
      capturedMinor: 143000,
      refundedMinor: 2000,
      gatewayFeesMinor: 0,
      netCapturedMinor: 141000,
    },
  };

  const vat: VatReport = {
    period: sales.period,
    currency: 'SAR',
    basis: 'gross',
    note: 'Gross output VAT on realised sales.',
    byRate: [
      { vatRate: '0.1500', orders: 11, taxableBaseMinor: 124348, vatMinor: 18652, totalMinor: 143000 },
    ],
    totalVatMinor: 18652,
    totalTaxableBaseMinor: 124348,
  };

  const kpis: ReportKpis = {
    period: sales.period,
    avgPrepTimeSeconds: 754,
    prepTimeSamples: 11,
    avgDeliveryTimeSeconds: null,
    deliveryTimeSamples: 0,
  };

  const input = {
    branchName: 'Rami Broast — Olaya',
    periodLabel: '2026-09-12',
    sales,
    payments,
    vat,
    kpis,
    printedAt: '2026-09-12T18:30:00.000Z',
  };

  it('prints the figures the server sent, formatted and not recomputed', () => {
    const t = buildSalesReportTicket(input);

    expect(t).toContain('SALES REPORT');
    expect(t).toContain('Rami Broast');
    expect(t).toContain('2026-09-12');
    expect(t).toContain('1430.00'); // the total, exactly as summed server-side
    expect(t).toContain('1300.00'); // items subtotal
  });

  it('prints a discount as a negative, because that is the direction it moves the total', () => {
    expect(buildSalesReportTicket(input)).toContain('-25.00');
  });

  it('states the VAT as included rather than as a row level with the others', () => {
    // Prices are VAT-inclusive. A VAT line flush with subtotal and delivery
    // reads as "+ VAT" to anyone checking the arithmetic by hand, which
    // overstates the day by the whole of the tax.
    const t = buildSalesReportTicket(input);
    expect(t).toContain('incl. VAT');
    expect(t).toContain('186.52');
  });

  it('says the realised figures exclude cancelled and unpaid orders', () => {
    // The status list above shows 13 orders and the revenue covers 11. Left
    // unsaid, the two read as a contradiction in our own arithmetic.
    // Unwrapped before matching: the caveat is longer than the roll, so it
    // legitimately spans lines — which is the wrapping working, not a missing
    // sentence.
    expect(unwrap(buildSalesReportTicket(input))).toContain(
      'Realised sales above exclude cancelled and unpaid orders.',
    );
  });

  it('carries both money caveats onto the paper, not only onto the screen', () => {
    // A number that leaves the screen has to take its qualifications with it,
    // and this sheet has a total and a VAT line, so it looks like a tax
    // invoice. This platform issues none — the restaurant issues its own.
    const t = unwrap(buildSalesReportTicket(input));
    expect(t).toContain('This is not a tax invoice.');
    expect(t).toContain('Gross output VAT. Refunds are not netted here.');
    expect(t).toContain('Cash on delivery may still read as pending.');
  });

  it('prints each charge by its own name, so a new fee needs no change here', () => {
    expect(buildSalesReportTicket(input)).toContain('Service fee');
  });

  it('prints a dash for a timing with nothing to average, never "0s"', () => {
    // The server sends null when no delivery completed in the window. "0s"
    // would read as instant delivery rather than as an empty window.
    const t = buildSalesReportTicket(input);
    expect(t).toContain('12m 34s'); // 754s of prep
    expect(t).toMatch(/Delivery \(0\) +—/);
  });

  it('omits a section the caller did not load rather than printing empty headings', () => {
    const t = buildSalesReportTicket({ branchName: null, periodLabel: 'x', sales });
    expect(t).toContain('REALISED SALES');
    expect(t).not.toContain('PAYMENTS');
    expect(t).not.toContain('VAT\n');
    expect(t).not.toContain('TIMINGS');
  });

  it('never exceeds the roll width, at either width', () => {
    // A line wider than the roll wraps mid-word at the printer, hard against
    // the margin — so a figure loses its leading digits onto the next line and
    // reads as a different number.
    for (const width of [32, 42]) {
      for (const line of buildSalesReportTicket(input, width).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('keeps the amount on the same line as its label at 32 columns', () => {
    // The narrow roll is where a long label pushes its amount onto its own
    // line, which is how a column of figures stops lining up with anything.
    const t = buildSalesReportTicket(input, 32);
    expect(t).toMatch(/Items subtotal +1300\.00/);
    expect(t).toMatch(/NET +SAR 1410\.00/);
  });
});
