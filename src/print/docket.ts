/**
 * The customer docket — the summary that goes out with the order.
 *
 * Laid out to the owner's format (2026-09-10): the logo, the restaurant's name
 * small under it, the order type large, who the customer is, when the food will
 * be ready, the items, what was charged and what was actually paid, the
 * reference, and a thank-you.
 *
 * **It is built from a template, not hard-coded**, because the next thing this
 * has to do is be editable per branch with a live preview — and a preview that
 * renders through a second copy of the layout is a preview of something else.
 * `DEFAULT_DOCKET_TEMPLATE` is what a branch gets before anyone edits anything;
 * an editor changes the same object this function already takes.
 *
 * Two rules it does not bend:
 *
 *  - **Nothing here computes a payable amount.** Every figure is a backend
 *    snapshot read off the order. `TOTAL PAID` is `order.totalMinor` itself,
 *    never the lines above it added up — if those disagree, the total is right
 *    and the presentation is wrong.
 *  - **It is not a tax invoice and says so.** Prices are VAT-inclusive, so the
 *    VAT is stated as already inside the total rather than laid out as a split
 *    an inspector would read as an invoice. The restaurant issues its ZATCA
 *    invoice separately (owner decision; see `backend/DEMO_DECISIONS.md`).
 */
import { KitchenOrder } from '../api/types';
import { formatAmount, formatSar } from '../util/money';
import { amountLine, center, centerBlock, itemLabel, itemLine, modifierLabel, orderTime, rule, wrapTo } from './layout';
import { DEFAULT_READY_TIME_RULES, ReadyTimeRules, readyWindow } from './readyTime';

export type DocketSectionId =
  | 'logo'
  | 'brand'
  | 'orderType'
  | 'orderMeta'
  | 'customer'
  | 'readyTime'
  | 'items'
  | 'totals'
  | 'reference'
  | 'thankYou';

export interface DocketTemplate {
  /**
   * The sections that print, in the order they print in. A section left out of
   * this list does not appear — which is how the editor's toggles and its
   * reordering are the same mechanism rather than two.
   */
  sections: DocketSectionId[];
  /**
   * Print the logo as an **image**, on by default.
   *
   * The text builder cannot express one — a picture is not characters — so the
   * printing path prepends it as its own job entry, and the `logo` section's
   * text lines below are what a printer that cannot manage an image gets.
   */
  printLogoImage: boolean;
  /** The owner's artwork. Null means the brand mark the app ships with. */
  logoImageUrl: string | null;
  /** How wide it prints, as a percentage of the paper. 100 is edge to edge. */
  logoWidthPercent: number;
  /**
   * The logo, as the lines to print above the name.
   *
   * Text, not an image: the print path sends plain text to the printer today,
   * and a raster logo is per-model work on hardware nobody here has yet.
   * Empty prints nothing at all rather than a gap where a logo should be.
   */
  logoLines: string[];
  /** The restaurant's name, small, under the logo. */
  brandLines: string[];
  /** Printed under the brand when the order carries a branch. */
  showBranchName: boolean;
  /** "New customer" on a first order. Never shown when the count is unknown. */
  showNewCustomerBadge: boolean;
  readyTimeRules: ReadyTimeRules;
  thankYouLines: string[];
  /**
   * The last word, and it earns its line: a document carrying a total and a VAT
   * figure looks like a tax invoice, and one filed as such is a problem for the
   * restaurant rather than for us.
   */
  footerLines: string[];
}

export const DEFAULT_DOCKET_TEMPLATE: DocketTemplate = {
  sections: [
    'logo',
    'brand',
    'orderType',
    'orderMeta',
    'customer',
    'readyTime',
    'items',
    'totals',
    'reference',
    'thankYou',
  ],
  printLogoImage: true,
  logoImageUrl: null,
  logoWidthPercent: 100,
  logoLines: [],
  brandLines: ['رامي', 'Rami Broast'],
  showBranchName: true,
  showNewCustomerBadge: true,
  readyTimeRules: DEFAULT_READY_TIME_RULES,
  thankYouLines: ['Thank you!', 'Please visit again.'],
  footerLines: ['Not a tax invoice'],
};

/** "Delivery" / "Pick up", as the owner words it. */
export function orderTypeLabel(type: KitchenOrder['type']): string {
  return type === 'DELIVERY' ? 'DELIVERY' : 'PICK UP';
}

/**
 * The discount lines, one per discount that actually paid.
 *
 * A discount is named by what gave it — "Promotion" and a coupon's code are
 * different things to a customer, and "Discount -15.00" answers neither
 * "which offer was that?" nor "did my code work?".
 *
 * **A promotion and a coupon can both apply to one order**, so the order's
 * `discounts` rows are the source: they carry what each one gave after the
 * pricing engine's clamp, and they sum to `discountMinor` exactly. An older
 * backend sends no rows, and then at most one discount can have applied — so
 * the whole of `discountMinor` is attributed to whichever offer the order
 * names, rather than being dropped or printed anonymously.
 */
export function discountLines(order: KitchenOrder): { label: string; amountMinor: number }[] {
  const recorded = (order.discounts ?? []).filter((d) => d.amountMinor > 0);
  if (recorded.length > 0) {
    return recorded.map((d) => ({
      label: d.kind === 'PROMOTION' ? `Promotion - ${d.label}` : `Coupon ${d.label}`,
      amountMinor: d.amountMinor,
    }));
  }

  const total = order.discountMinor ?? 0;
  if (total <= 0) {
    return [];
  }
  if (order.promotion) {
    return [{ label: `Promotion - ${order.promotion.name}`, amountMinor: total }];
  }
  if (order.coupon) {
    const name = order.coupon.name ? ` - ${order.coupon.name}` : '';
    return [{ label: `Coupon ${order.coupon.code}${name}`, amountMinor: total }];
  }
  return [{ label: 'Discount', amountMinor: total }];
}

function customerSection(order: KitchenOrder, template: DocketTemplate, width: number): string[] {
  const customer = order.customer;
  if (!customer) {
    return [];
  }
  const lines: string[] = [];
  if (customer.fullName) {
    lines.push(...wrapTo(customer.fullName, width));
  }
  lines.push(customer.phone);
  // A first order counts itself, so 1 is new. Absent is unknown, and unknown
  // prints nothing: calling a regular customer new is the visible mistake.
  const orders = customer._count?.orders;
  if (template.showNewCustomerBadge && typeof orders === 'number' && orders <= 1) {
    lines.push('** New customer **');
  }
  return lines;
}

function itemsSection(order: KitchenOrder, width: number): string[] {
  const lines: string[] = [];
  for (const item of order.items) {
    // The pre-discount amount, because the discount gets its own line below.
    // Listing lines at their discounted amount *and* subtracting the discount
    // again is the one arithmetic error a customer will always spot.
    const gross = item.lineSubtotalMinor ?? item.lineTotalMinor;
    const amount = typeof gross === 'number' ? formatAmount(gross) : null;
    lines.push(...amountLine(itemLine(item.quantity, itemLabel(item)), amount, width, '     '));
    for (const mod of item.modifiers ?? []) {
      lines.push(...wrapTo(`     ${modifierLabel(mod)}`, width, '       '));
    }
    const note = item.notes?.trim();
    if (note) {
      lines.push(...wrapTo(`     ** ${note}`, width, '        '));
    }
  }
  return lines;
}

function totalsSection(order: KitchenOrder, width: number): string[] {
  const lines: string[] = [];

  if (typeof order.subtotalMinor === 'number') {
    lines.push(...amountLine('Items', formatAmount(order.subtotalMinor), width));
  }
  if (order.deliveryFeeMinor) {
    lines.push(...amountLine('Delivery fee', formatAmount(order.deliveryFeeMinor), width));
  }
  // Charges print by their own names — a platform fee, a service fee, anything
  // the owner adds — so a new fee appears on the docket with no code change.
  for (const charge of order.orderCharges ?? []) {
    lines.push(...amountLine(charge.name, formatAmount(charge.totalMinor), width));
  }
  if ((order.orderCharges ?? []).length === 0 && order.chargesMinor) {
    lines.push(...amountLine('Charges', formatAmount(order.chargesMinor), width));
  }
  for (const discount of discountLines(order)) {
    lines.push(...amountLine(discount.label, `-${formatAmount(discount.amountMinor)}`, width));
  }

  lines.push(rule(width));
  // The snapshot itself, never the lines above added up.
  lines.push(...amountLine('TOTAL PAID', formatSar(order.totalMinor), width));

  if (typeof order.vatMinor === 'number') {
    const rate = Number(order.vatRate);
    const label = Number.isFinite(rate) && rate > 0 ? `Includes VAT (${(rate * 100).toFixed(0)}%)` : 'Includes VAT';
    lines.push(...amountLine(label, formatSar(order.vatMinor), width));
  }
  return lines;
}

function section(id: DocketSectionId, order: KitchenOrder, template: DocketTemplate, width: number): string[] {
  switch (id) {
    case 'logo':
      return template.logoLines.flatMap((line) => centerBlock(line, width));
    case 'brand': {
      const lines = template.brandLines.flatMap((line) => centerBlock(line, width));
      if (template.showBranchName && order.branch?.name) {
        lines.push(...centerBlock(order.branch.name, width));
      }
      return lines;
    }
    case 'orderType':
      // The one thing read from across a counter. It is centred and alone on
      // its line; making it physically larger needs ESC/POS size codes, which
      // the print path does not send yet.
      return ['', center(orderTypeLabel(order.type), width), ''];
    case 'orderMeta':
      return [`Order ${order.orderNumber}`, orderTime(order.placedAt)];
    case 'customer': {
      const lines = customerSection(order, template, width);
      // A blank line above, so the customer does not read as one more line of
      // order metadata at a glance.
      return lines.length > 0 ? ['', ...lines] : [];
    }
    case 'readyTime': {
      const window = readyWindow(
        order.placedAt,
        order.subtotalMinor ?? order.totalMinor,
        order.type,
        template.readyTimeRules,
      );
      // No window means the placement time could not be read. A made-up
      // "ready by" is a promise to a customer that nothing stands behind.
      return window ? ['', `Ready ${window.fromClock} - ${window.toClock}`] : [];
    }
    case 'items':
      return [rule(width), ...itemsSection(order, width), rule(width)];
    case 'totals':
      return totalsSection(order, width);
    case 'reference':
      // The globally unique handle. Order numbers repeat across branches, so
      // this is the number that finds this order when the customer rings.
      return order.referenceId ? [rule(width), `Ref ${order.referenceId}`] : [];
    case 'thankYou':
      return [
        '',
        ...template.thankYouLines.flatMap((line) => centerBlock(line, width)),
        ...template.footerLines.flatMap((line) => centerBlock(line, width)),
      ];
    default:
      return [];
  }
}

/** The customer docket: an order summary that goes out with the food. */
export function buildDocket(
  order: KitchenOrder,
  width: number = 42,
  template: DocketTemplate = DEFAULT_DOCKET_TEMPLATE,
): string {
  const lines: string[] = [rule(width, '=')];
  for (const id of template.sections) {
    lines.push(...section(id, order, template, width));
  }
  lines.push(rule(width, '='));
  // Trailing spaces cost nothing on screen and a visible ragged edge on paper.
  return lines.map((line) => line.replace(/\s+$/, '')).join('\n');
}
