/**
 * Pure ticket builders — no React, no printer I/O, so they are fully unit-tested.
 *
 * Two documents, never an invoice (the restaurant issues its own ZATCA invoice):
 *  - the **kitchen ticket** the line cooks work from (items, their prices and
 *    an items total), and
 *  - the **customer docket** that goes out with the order (items + total).
 *
 * The **docket** carries the order's globally unique 12-digit reference beside
 * the branch's own order number: the number is what the counter calls out, the
 * reference is what identifies the order when the customer rings about it,
 * since order numbers count per branch and repeat across them. The **kitchen
 * ticket** carries the order number only (owner decision, 2026-09-10) — it
 * never leaves the branch, and nobody quotes a reference to a cook.
 *
 * Output is plain text sized for a narrow thermal roll; the printer adapter
 * turns it into the model's raster/ESC-POS commands.
 */
import { KitchenOrder, PaymentsReport, ReportKpis, SalesReport, VatReport } from '../api/types';
import { formatAmount, formatSar } from '../util/money';
import { buildDocket } from './docket';
import { amountLine, center, itemLabel, itemLine, modifierLabel, orderTime, rule, wrapTo } from './layout';

import { DocketTemplate } from './docket';

export { buildDocket, DEFAULT_DOCKET_TEMPLATE } from './docket';
export type { DocketTemplate, DocketSectionId } from './docket';

/**
 * The two documents an **order** produces.
 *
 * Kept apart from `TicketKind` because `buildTicket` treats anything that is
 * not `kitchen` as a docket, so a third value silently reaching it would print
 * a customer receipt for something that is not an order.
 */
export type OrderTicketKind = 'kitchen' | 'docket';

/**
 * Everything this app prints, which is what the print log and the printer-role
 * mapping are keyed on. `report` goes to the `main` printer like a docket does
 * (`profileFor`), but it is not an order document and has no duplicate guard —
 * reprinting a shift summary is an ordinary thing to want.
 */
export type TicketKind = OrderTicketKind | 'report';

/**
 * Characters per line for each roll width, in the printer's default font.
 *
 * A ticket wider than the roll wraps mid-word and a cook loses the quantity at
 * the start of the next line, so this has to match the paper actually loaded.
 * 80mm fits 48 columns and 58mm fits 32 at font A on the common ESC/POS
 * printers; 42 is used for 80mm to leave a margin for models that fit slightly
 * fewer, since a short line is harmless and a wrapped one is not.
 */
const COLUMNS: Record<number, number | undefined> = { 58: 32, 80: 42 };

const DEFAULT_WIDTH = 42;

export function columnsFor(paperWidth: number): number {
  return COLUMNS[paperWidth] ?? DEFAULT_WIDTH;
}

/**
 * The kitchen ticket: what to cook, what each line cost, and what the food
 * comes to.
 *
 * The shape is the owner's (2026-09-10): branch, order number, the placing
 * time to the second, every item with its quantity and price, a note printed
 * under the item it belongs to, an items total, and a thank-you.
 *
 * Two rules it keeps:
 *
 *  - **A price that is not known is not printed.** `lineTotalMinor` absent
 *    means an older backend did not send it, not that the line was free — so
 *    the amount is left off, and the items total with it, rather than printing
 *    a figure nobody can reconcile.
 *  - **The amount on an item line is that whole line**, add-ons included, so
 *    the column adds up to the items total exactly. Add-ons print by name only
 *    for that reason; their prices are already in the line above them.
 */
export function buildKitchenTicket(order: KitchenOrder, width: number = DEFAULT_WIDTH): string {
  const lines: string[] = [];
  lines.push(rule(width, '='));
  if (order.branch?.name) {
    lines.push(...wrapTo(order.branch.name, width));
  }
  lines.push(`Order ${order.orderNumber}`);
  // The kitchen has to know whether this is going out on a bike: a pickup is
  // bagged for a counter and a delivery is packed for a journey.
  lines.push(order.type);
  lines.push(orderTime(order.placedAt));
  lines.push(rule(width));

  for (const item of order.items) {
    const amount = typeof item.lineTotalMinor === 'number' ? formatAmount(item.lineTotalMinor) : null;
    lines.push(...amountLine(itemLine(item.quantity, itemLabel(item)), amount, width, '     '));
    for (const mod of item.modifiers ?? []) {
      lines.push(...wrapTo(`     ${modifierLabel(mod)}`, width, '       '));
    }
    // Only where there is one: a blank "NOTE:" heading under every item is a
    // line a cook learns to skip, which is how the one order that has a note
    // gets skipped with it.
    const note = item.notes?.trim();
    if (note) {
      lines.push(...wrapTo(`     ** ${note}`, width, '        '));
    }
  }

  // The order-level note is the whole order's, so it goes at the foot rather
  // than under whichever item happens to be last.
  const orderNote = order.customerNotes?.trim();
  if (orderNote) {
    lines.push(rule(width));
    lines.push('NOTE:');
    lines.push(...wrapTo(orderNote, width));
  }

  lines.push(rule(width));
  const priced = order.items.every((item) => typeof item.lineTotalMinor === 'number');
  if (priced) {
    const itemsMinor = order.items.reduce((sum, item) => sum + (item.lineTotalMinor ?? 0), 0);
    // Deliberately labelled ITEMS, not TOTAL: delivery fees, charges and any
    // order-level discount sit outside these lines, so on a delivery order
    // this is not what the customer pays and must not be read as it.
    lines.push(...amountLine('ITEMS TOTAL', formatSar(itemsMinor), width));
  }
  lines.push('Thank you!');
  lines.push(rule(width, '='));
  return lines.join('\n');
}

export function buildTicket(
  kind: OrderTicketKind,
  order: KitchenOrder,
  width: number = DEFAULT_WIDTH,
  template?: DocketTemplate,
): string {
  // The kitchen ticket takes no template: it is the branch's own working
  // document, not the one the owner's brand goes on.
  return kind === 'kitchen' ? buildKitchenTicket(order, width) : buildDocket(order, width, template);
}

// ---------------------------------------------------------------------------
// The shift report
// ---------------------------------------------------------------------------

/** What the report ticket needs beyond the figures themselves. */
export interface ReportTicketInput {
  branchName?: string | null;
  /** The window as a person reads it, e.g. `12/09/2026` or `01/09 - 12/09`. */
  periodLabel: string;
  sales: SalesReport;
  vat?: VatReport | null;
  payments?: PaymentsReport | null;
  kpis?: ReportKpis | null;
  /** When it was printed. Passed in, never read off the clock, so it is testable. */
  printedAt?: string;
}

/** `Xm Ys`, or a dash when there was nothing to average. */
function duration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '—';
  }
  const whole = Math.max(0, Math.round(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * The end-of-shift summary, on the roll the counter already has.
 *
 * This exists because the figure a branch needs at handover is one somebody has
 * to be able to hold: a screen closes when the browser does, and the person
 * taking over the till is not the person who read it. Every number is the
 * server's own sum — this builder formats and never totals, the same rule the
 * order tickets keep.
 *
 * Three things it prints that the screen also says, because **a number that
 * leaves the screen has to take its qualifications with it**:
 *
 *  - **It is not a tax invoice.** The sheet carries a total and a VAT line, so
 *    it looks like one, and this platform deliberately issues none (the
 *    restaurant issues its ZATCA invoice through its own systems). A document
 *    that reads as a tax invoice and is not one is worse than no document.
 *  - **The VAT is gross output VAT**, never net of refunds — permanently, since
 *    invoicing is out of scope. Whoever prepares the return nets refunds from
 *    the restaurant's own records.
 *  - **Realised sales exclude cancelled and unpaid orders**, so the order count
 *    beside the revenue is not the same as the count in the status list above
 *    it. Left unsaid, the two look like a contradiction in our own arithmetic.
 */
export function buildSalesReportTicket(
  input: ReportTicketInput,
  width: number = DEFAULT_WIDTH,
): string {
  const { sales } = input;
  const lines: string[] = [];

  lines.push(rule(width, '='));
  if (input.branchName) {
    lines.push(...wrapTo(input.branchName, width).map((l) => center(l, width)));
  }
  lines.push(center('SALES REPORT', width));
  lines.push(...wrapTo(input.periodLabel, width).map((l) => center(l, width)));
  if (input.printedAt) {
    lines.push(center(`Printed ${orderTime(input.printedAt)}`, width));
  }
  lines.push(rule(width, '='));

  // --- Realised sales -------------------------------------------------------
  lines.push('REALISED SALES');
  lines.push(...amountLine('Orders', String(sales.realised.orders), width));
  lines.push(...amountLine('Items subtotal', formatAmount(sales.realised.subtotalMinor), width));
  if (sales.realised.discountMinor > 0) {
    // Printed as a negative because that is the direction it moves the total,
    // and a bare positive under "subtotal" reads as something added.
    lines.push(...amountLine('Discounts', `-${formatAmount(sales.realised.discountMinor)}`, width));
  }
  lines.push(...amountLine('Delivery fees', formatAmount(sales.realised.deliveryFeeMinor), width));
  if (sales.realised.chargesMinor > 0) {
    lines.push(...amountLine('Charges', formatAmount(sales.realised.chargesMinor), width));
  }
  lines.push(rule(width));
  lines.push(...amountLine('TOTAL', formatSar(sales.realised.totalMinor), width));
  // "of which" and not a row flush with the others: prices are VAT-inclusive,
  // so a VAT line sitting level with subtotal and delivery reads as "+ VAT" to
  // anyone checking the arithmetic, and the sheet would overstate the day.
  lines.push(...amountLine('incl. VAT', formatAmount(sales.realised.vatMinor), width));
  lines.push(rule(width));

  // --- Every charge by its own name ----------------------------------------
  if (sales.charges.length > 0) {
    lines.push('CHARGES');
    for (const charge of sales.charges) {
      lines.push(...amountLine(`${charge.name} x${charge.count}`, formatAmount(charge.totalMinor), width));
    }
    lines.push(rule(width));
  }

  // --- Orders by status -----------------------------------------------------
  if (sales.statusBreakdown.length > 0) {
    lines.push('ORDERS BY STATUS');
    for (const row of sales.statusBreakdown) {
      lines.push(...amountLine(row.status, String(row.orders), width));
    }
    lines.push(...wrapTo('Realised sales above exclude cancelled and unpaid orders.', width));
    lines.push(rule(width));
  }

  // --- Money taken, by method ----------------------------------------------
  if (input.payments) {
    lines.push('PAYMENTS');
    for (const row of input.payments.byMethod) {
      lines.push(...amountLine(row.method ?? 'Unknown', formatAmount(row.capturedMinor), width));
    }
    lines.push(...amountLine('Captured', formatAmount(input.payments.totals.capturedMinor), width));
    if (input.payments.totals.refundedMinor > 0) {
      lines.push(
        ...amountLine('Refunded', `-${formatAmount(input.payments.totals.refundedMinor)}`, width),
      );
    }
    lines.push(...amountLine('NET', formatSar(input.payments.totals.netCapturedMinor), width));
    // Cash on delivery is captured when the driver hands the money over, so a
    // COD order still out reads as pending here rather than as money taken.
    lines.push(...wrapTo('Cash on delivery may still read as pending.', width));
    lines.push(rule(width));
  }

  // --- VAT ------------------------------------------------------------------
  if (input.vat) {
    lines.push('VAT');
    for (const row of input.vat.byRate) {
      lines.push(...amountLine(`Rate ${row.vatRate}`, formatAmount(row.vatMinor), width));
    }
    lines.push(...amountLine('TOTAL VAT', formatSar(input.vat.totalVatMinor), width));
    lines.push(...wrapTo('Gross output VAT. Refunds are not netted here.', width));
    lines.push(rule(width));
  }

  // --- Timings --------------------------------------------------------------
  if (input.kpis) {
    lines.push('TIMINGS');
    lines.push(
      ...amountLine(
        `Prep (${input.kpis.prepTimeSamples})`,
        duration(input.kpis.avgPrepTimeSeconds),
        width,
      ),
    );
    lines.push(
      ...amountLine(
        `Delivery (${input.kpis.deliveryTimeSamples})`,
        duration(input.kpis.avgDeliveryTimeSeconds),
        width,
      ),
    );
    lines.push(rule(width));
  }

  lines.push(...wrapTo('This is not a tax invoice.', width).map((l) => center(l, width)));
  lines.push(rule(width, '='));
  return lines.join('\n');
}
