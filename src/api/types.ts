/** API response shapes the Branch POS uses, mirrored from the backend. */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Response from /auth/me — tells the POS who is signed in and their branch. */
export interface CurrentActor {
  kind: 'STAFF' | 'CUSTOMER';
  id: string;
  email?: string;
  fullName?: string;
  roles: string[];
  permissions: string[];
  // The backend sends 'ALL' (src/auth/types/actor.ts). This union said
  // 'ALL_BRANCHES', a value the server never sends, so an owner signing in here
  // matched none of the three branches of the union: no assigned branch id and
  // not recognised as reaching every branch either, which is the "this terminal
  // has no branch" screen rather than the multi-branch warning.
  branchScope: { kind: 'ALL' | 'ASSIGNED' | 'NONE'; branchIds?: string[] };
}

/** A branch as returned by the public `/branches` list, with its operating settings. */
export interface Branch {
  id: string;
  name: string;
  nameAr: string | null;
  addressLine?: string | null;
  district?: string | null;
  city?: string | null;
  settings?: {
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    isAcceptingOrders: boolean;
    acceptsCashOnDelivery: boolean;
    deliveryFeeMinor: number;
    minOrderMinor: number;
    prepTimeMinutes?: number;
  } | null;
}

/** The staff/list response envelope the backend uses for paginated reads. */
export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; pageCount: number };
}

// --- Menu (public `/branches/:id/menu`) ------------------------------------

export interface MenuAddon {
  id: string;
  name: string;
  nameAr: string | null;
  priceMinor: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  nameAr: string | null;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  addons: MenuAddon[];
}

export interface MenuVariant {
  id: string;
  name: string;
  nameAr: string | null;
  priceMinor: number;
  isDefault: boolean;
}

export interface MenuProduct {
  id: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  priceMinor: number;
  /**
   * Whether this branch is currently selling the product. The menu lists the
   * whole catalogue and flags what the branch cannot make right now, so this
   * must be honoured before an item is added to a cart — the backend rejects
   * an unavailable item at placement, which is far too late to tell someone
   * standing at the counter.
   */
  isAvailable: boolean;
  /**
   * When a timed stock-out ends, as an ISO-8601 instant, or null.
   *
   * Null covers two different situations and the UI must not conflate them:
   * the item is on sale, or it is off with **no time promised** — the supplier
   * failed and nobody can say when. Only `isAvailable` distinguishes them.
   */
  unavailableUntil?: string | null;
  variants: MenuVariant[];
  modifierGroups: MenuModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  nameAr: string | null;
  products: MenuProduct[];
}

export interface BranchMenu {
  branch: { id: string; name: string; nameAr: string | null };
  deliveryFeeMinor: number;
  minOrderMinor: number;
  categories: MenuCategory[];
}

// --- Counter order entry (staff `POST /orders`) ----------------------------

export type CounterPaymentMethod = 'CASH' | 'CASH_ON_DELIVERY';

export interface CounterOrderCartItem {
  productId: string;
  productVariantId?: string;
  quantity: number;
  addonIds?: string[];
  notes?: string;
}

export interface CounterOrderAddress {
  line1: string;
  line2?: string;
  district?: string;
  city: string;
  postalCode?: string;
  notes?: string;
  label?: string;
}

/**
 * The authoritative price of a cart, from the backend's pricing engine. The POS
 * *displays* this; it never computes a payable amount itself.
 */
export interface PriceQuote {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  vatMinor: number;
  totalMinor: number;
}

export interface CounterOrderInput {
  branchId: string;
  type: OrderType;
  customerPhone: string;
  customerName?: string;
  paymentMethod: CounterPaymentMethod;
  cashCollected?: boolean;
  deliveryAddress?: CounterOrderAddress;
  items: CounterOrderCartItem[];
  customerNotes?: string;
}

// --- Deliveries + drivers (staff, branch-isolated) -------------------------

export type DeliveryStatus =
  | 'PENDING_ASSIGNMENT'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export interface DeliveryAddressSnapshot {
  label: string | null;
  line1: string;
  line2: string | null;
  district: string | null;
  city: string;
  postalCode: string | null;
  notes: string | null;
}

/** The assigned driver, as the delivery view exposes them — never a phone number. */
export interface DeliveryDriver {
  id: string;
  vehicleType: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: string | null;
  user: { fullName: string | null };
}

export interface Delivery {
  id: string;
  orderId: string;
  branchId: string;
  driverId: string | null;
  status: DeliveryStatus;
  addressSnapshot: DeliveryAddressSnapshot | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  recipientName: string | null;
  createdAt: string;
  order: { orderNumber: string; referenceId?: string; branchId: string; status: OrderStatus } | null;
  driver: DeliveryDriver | null;
}

/** A driver, as the staff `/drivers` list exposes them, for assignment. */
export interface Driver {
  id: string;
  vehicleType: string | null;
  vehiclePlate: string | null;
  isOnline: boolean;
  isAvailable: boolean;
  /**
   * How many deliveries they are carrying right now.
   *
   * Optional because a backend older than stacked assignment does not send it —
   * and a missing count means *unknown*, never zero. Read it through
   * `util/driverPicker.ts`, which keeps that distinction: treating an absent
   * count as zero would put a driver the server called busy at the top of the
   * picker.
   */
  activeDeliveryCount?: number;
  user: { fullName: string | null };
}

export interface OrderItemModifier {
  id: string;
  addonName: string;
  quantity: number;
}

export interface OrderItem {
  id: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  modifiers?: OrderItemModifier[];
  /**
   * The snapshotted price of this line as charged — the product, its add-ons
   * and this quantity, after any discount allocated to it.
   *
   * Optional because it is **unknown**, never zero, when an older backend
   * omits it: a missing price is left off the ticket rather than printed as
   * 0.00, and a ticket with any unpriced line prints no items total at all.
   */
  lineTotalMinor?: number;
  /**
   * What this line was worth **before** any discount was allocated to it.
   *
   * The two are different numbers and a document must not mix them: a receipt
   * that lists lines at their discounted amount *and* shows the discount as
   * its own line has subtracted it twice.
   */
  lineSubtotalMinor?: number;
  /** The product's own unit price, excluding add-ons. */
  unitPriceMinor?: number;
  /**
   * A note against **this item** ("no onions"), as distinct from the
   * order-level `customerNotes`. The kitchen ticket prints it under the item
   * it belongs to, and prints nothing where an item has none.
   */
  notes?: string | null;
}

/**
 * Mirrors the backend's OrderStatus enum exactly.
 *
 * It previously carried `COMPLETED` and `REJECTED`, which the backend has no
 * values for — a completed pickup is `DELIVERED` and a branch rejection is a
 * `CANCELLED` order carrying the reason. It was also missing the refund states,
 * which the backend does send. Both directions matter: a status that never
 * arrives invites dead code, and one that arrives unlisted falls through
 * whatever maps it.
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'AWAITING_ACCEPTANCE'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'DRIVER_ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type OrderType = 'DELIVERY' | 'PICKUP';

/** An order as it appears in the kitchen / new-orders queues. */
export interface KitchenOrder {
  id: string;
  /**
   * This branch's own running number, counting from 1000000. Unique only
   * within the branch — another branch has its own "1000000" — so it is what
   * the counter calls out, never what identifies the order platform-wide.
   */
  orderNumber: string;
  /** Globally unique 12-digit public reference for this exact order. */
  referenceId?: string;
  /** Money state, tracked independently of `status`. Never derived from it. */
  paymentStatus?: string;
  type: OrderType;
  status: OrderStatus;
  totalMinor: number;
  currency: string;
  customerNotes: string | null;
  placedAt: string;
  items: OrderItem[];
  branch?: { id: string; code: string; name: string; nameAr: string | null };
  customer?: {
    id: string;
    phone: string;
    fullName: string | null;
    /**
     * How many orders this customer has, **this one included** — so 1 is a
     * first order. Absent means an older backend did not send it, which is
     * unknown and not "new": a receipt saying "new customer" over a regular is
     * the wrong that gets noticed at the counter.
     */
    _count?: { orders: number };
  };

  // --- The money, as the backend snapshotted it ------------------------------
  // Every one of these is a stored column. The POS displays them; it never
  // adds them up to reach a payable amount.

  /** Gross value of the items, **before** any discount. */
  subtotalMinor?: number;
  /** Item and delivery discounts together, as a positive number. */
  discountMinor?: number;
  /** The delivery fee before any discount was spent on it. */
  deliveryFeeMinor?: number;
  /** Every configured charge together — the platform fee and anything beside it. */
  chargesMinor?: number;
  /** The VAT already inside `totalMinor`. Prices are VAT-inclusive. */
  vatMinor?: number;
  /** The snapshotted rate, e.g. "0.1500". */
  vatRate?: string | number;
  /** Each charge by its own name, so a fee appears without a code change. */
  orderCharges?: { id: string; name: string; nameAr?: string | null; totalMinor: number }[];
  /** The code the customer typed, when a coupon paid. */
  coupon?: { id: string; code: string; name: string | null } | null;
  /** The standing offer that paid, when one did. */
  promotion?: { id: string; name: string } | null;
  /**
   * What each discount actually gave. Since a promotion and a coupon may both
   * apply to one order, `coupon` and `promotion` no longer say which took what
   * off — these rows do, at the amount given after the engine's clamp.
   */
  discounts?: {
    id: string;
    kind: 'COUPON' | 'PROMOTION';
    label: string;
    amountMinor: number;
    appliesToDeliveryFee?: boolean;
  }[];
}

// --- Reports (`/reports/*`, `reports:read`, branch-isolated) ----------------

/**
 * The reports read **snapshotted** order data, not the live catalogue — so a
 * menu price changed this afternoon cannot move this morning's figures, and a
 * report run twice returns the same numbers. Every amount is integer minor
 * units the server summed; the POS displays them and never adds anything up
 * itself, exactly like an order total.
 */
export interface ReportPeriod {
  from: string;
  to: string;
}

export interface SalesReport {
  period: ReportPeriod;
  currency: string;
  /**
   * Every status the window contains, revenue-bearing or not.
   *
   * Read this beside `realised` rather than instead of it: a cancelled or
   * payment-failed order appears here and is deliberately **excluded** from the
   * revenue figures below, so the two counts legitimately differ and a screen
   * that presented one as the other would overstate the day.
   */
  statusBreakdown: { status: string; orders: number; totalMinor: number }[];
  /**
   * Realised sales only — CONFIRMED onward, including the refund states, since
   * the sale happened and a refund is a separate money movement.
   */
  realised: {
    orders: number;
    subtotalMinor: number;
    discountMinor: number;
    deliveryFeeMinor: number;
    chargesMinor: number;
    taxableBaseMinor: number;
    /** The VAT already inside `totalMinor`. Prices are VAT-inclusive. */
    vatMinor: number;
    totalMinor: number;
  };
  /** Each charge by its own name, so a fee the owner adds needs no change here. */
  charges: { name: string; count: number; grossMinor: number; vatMinor: number; totalMinor: number }[];
}

export interface VatReport {
  period: ReportPeriod;
  currency: string;
  /**
   * Always `"gross"`, permanently. Invoicing is out of scope for this platform,
   * so refund and credit-note VAT is never netted here — the restaurant nets it
   * from its own invoicing records. The server sends this field and its `note`
   * precisely so neither can be mistaken for net, and both are shown on screen
   * **and printed**: a number that leaves the screen has to take its
   * qualifications with it.
   */
  basis: string;
  note: string;
  /** Grouped by the rate snapshotted per order, so a rate change shows as two rows. */
  byRate: {
    vatRate: string;
    orders: number;
    taxableBaseMinor: number;
    vatMinor: number;
    totalMinor: number;
  }[];
  totalVatMinor: number;
  totalTaxableBaseMinor: number;
}

export interface PaymentsReport {
  period: ReportPeriod;
  currency: string;
  byStatus: { status: string; payments: number; capturedMinor: number; refundedMinor: number }[];
  byMethod: {
    method: string | null;
    payments: number;
    capturedMinor: number;
    refundedMinor: number;
  }[];
  totals: {
    payments: number;
    capturedMinor: number;
    refundedMinor: number;
    gatewayFeesMinor: number;
    netCapturedMinor: number;
  };
}

/**
 * Prep and delivery timings over the window.
 *
 * Both are **null when there is nothing to average** — no order reached READY,
 * no delivery completed — which is a different thing from an average of zero
 * and must not be rendered as "0 min". `samples` is how many orders each is
 * built from, because an average of one order is not a figure to change a
 * kitchen over.
 */
export interface ReportKpis {
  period: ReportPeriod;
  avgPrepTimeSeconds: number | null;
  prepTimeSamples: number;
  avgDeliveryTimeSeconds: number | null;
  deliveryTimeSamples: number;
}
