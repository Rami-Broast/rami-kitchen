import { ApiClient } from './http';
import {
  AuthTokens,
  Branch,
  BranchMenu,
  CounterOrderInput,
  CurrentActor,
  Delivery,
  DeliveryStatus,
  Driver,
  KitchenOrder,
  OrderStatus,
  OrderType,
  Paginated,
  PaymentsReport,
  PriceQuote,
  ReportKpis,
  SalesReport,
  VatReport,
} from './types';
import { DocketTemplate } from '../print/docket';

/** The window and branch every report read carries. */
export interface ReportWindowQuery {
  /** Inclusive ISO-8601 instant. */
  from: string;
  /** Inclusive ISO-8601 instant. */
  to: string;
  branchId?: string;
}

/**
 * Builds a report query string.
 *
 * One helper for all four reads rather than four near-identical lines:
 * `forbidNonWhitelisted` is on server-side, so a parameter a DTO does not
 * declare turns the whole tab into a 400 that reads as "the reports won't
 * load" — and a typo repeated three times out of four is the version of that
 * which only shows on one tab.
 */
function reportQuery(window: ReportWindowQuery): string {
  const params = new URLSearchParams({ from: window.from, to: window.to });
  if (window.branchId) {
    params.set('branchId', window.branchId);
  }
  return params.toString();
}

/**
 * Typed backend endpoints the Branch POS uses. Branch staff sign in and work
 * the incoming-order queues; every route is branch-isolated server-side.
 */
export class Api {
  constructor(private readonly http: ApiClient) {}

  // --- Auth -----------------------------------------------------------------
  login(email: string, password: string): Promise<AuthTokens> {
    return this.http.request('/auth/staff/login', { method: 'POST', body: { email, password }, public: true });
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.http.request('/auth/refresh', { method: 'POST', body: { refreshToken }, public: true });
  }

  /**
   * Ends the session server-side.
   *
   * Clearing the token locally is not signing out: the refresh token stays
   * valid for its full 30 days, so a shared terminal or a lost device keeps a
   * working session. This revokes the family. Callers clear local state
   * regardless of the result — signing out must never fail because the network
   * did.
   */
  logout(refreshToken: string): Promise<void> {
    return this.http.request('/auth/logout', {
      method: 'POST',
      body: { refreshToken },
      public: true,
    });
  }

  me(): Promise<CurrentActor> {
    return this.http.request('/auth/me');
  }

  // --- Branch + menu (public) ------------------------------------------------
  /** The active branches. Public — used to resolve the signed-in branch's name and settings. */
  branches(): Promise<Branch[]> {
    // `/customer/branches`, not `/branches`: the latter is the staff resource
    // with a different projection. See the backend catalog controller.
    return this.http.request('/customer/branches', { public: true });
  }

  /**
   * The docket template this branch prints — the owner's layout with this
   * branch's own overrides already applied by the server.
   *
   * Authenticated and branch-scoped: asking for another branch's template is a
   * 403, like every other branch-owned read.
   */
  receiptTemplate(branchId: string): Promise<{
    resolved: DocketTemplate;
    organisationDefault: DocketTemplate;
    override: Partial<DocketTemplate>;
  }> {
    return this.http.request(`/receipt-templates/branches/${encodeURIComponent(branchId)}`);
  }

  /**
   * Sets this branch's own override of the owner's template.
   *
   * **Only the two fields a branch may set.** The backend's
   * `BRANCH_OVERRIDABLE_KEYS` is the enforcement and its DTO refuses anything
   * else outright, so sending the layout, the brand lines or the footer from
   * here would be a 400 rather than a change nobody authorised. The permission
   * is `receipt-template:branch`, which BRANCH_ADMIN holds and KITCHEN does
   * not — the Receipt screen renders the editor only for an account that has
   * it, rather than offering a control that answers 403.
   */
  saveBranchReceiptTemplate(
    branchId: string,
    override: { readyTimeRules?: DocketTemplate['readyTimeRules']; thankYouLines?: string[] },
  ): Promise<{ resolved: DocketTemplate; override: Partial<DocketTemplate> }> {
    return this.http.request(`/receipt-templates/branches/${encodeURIComponent(branchId)}`, {
      method: 'PUT',
      body: override,
    });
  }

  /** Drops this branch back to the owner's template, override and all. */
  clearBranchReceiptTemplate(branchId: string): Promise<{ resolved: DocketTemplate }> {
    return this.http.request(`/receipt-templates/branches/${encodeURIComponent(branchId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * The public certificate QZ Tray checks against its trust store.
   *
   * Plain text, not JSON: it is handed to QZ verbatim. A 503 here means no
   * certificate is configured, which is a working state — the branch prints
   * with QZ's prompt.
   */
  qzCertificate(): Promise<string> {
    return this.http.request('/printing/qz/certificate', { text: true });
  }

  /**
   * Has the platform sign one QZ request. The private key is on the server and
   * never in this bundle — a key in a static web app is a published key.
   */
  async qzSign(request: string): Promise<string> {
    const { signature } = await this.http.request<{ signature: string }>('/printing/qz/sign', {
      method: 'POST',
      body: { request },
    });
    return signature;
  }

  /** The menu the branch currently sells, priced VAT-inclusive. Public, like the customer app. */
  branchMenu(branchId: string): Promise<BranchMenu> {
    return this.http.request(`/branches/${encodeURIComponent(branchId)}/menu`, { public: true });
  }

  /**
   * The authoritative price of a cart, so the POS can show a running total it
   * never computes itself. Carries no prices in the request.
   *
   * **Authenticated.** Pricing is not a public endpoint: sending this without
   * the token returns 401, and because the caller swallows a failed quote the
   * counter would simply show no total at all. Staff are always signed in here.
   */
  quoteCart(branchId: string, type: OrderType, items: CounterOrderInput['items']): Promise<PriceQuote> {
    return this.http.request('/pricing/quote', {
      method: 'POST',
      body: { branchId, type, items },
    });
  }

  // --- Counter order entry (orders:write, branch-isolated server-side) --------
  /**
   * Places a walk-in / phone order at the counter. The backend validates the
   * branch against the caller's scope and prices everything server-side — the
   * POS never sends a price.
   */
  createCounterOrder(input: CounterOrderInput, idempotencyKey?: string): Promise<KitchenOrder> {
    return this.http.request('/orders', { method: 'POST', body: input, idempotencyKey });
  }

  // --- Deliveries + drivers (branch-isolated server-side) --------------------
  /** This branch's deliveries. Server restricts the result to the caller's branch. */
  deliveries(branchId: string, status?: DeliveryStatus): Promise<Paginated<Delivery>> {
    const params = new URLSearchParams({ branchId, limit: '100' });
    if (status) {
      params.set('status', status);
    }
    return this.http.request(`/deliveries?${params.toString()}`);
  }

  /**
   * Drivers this branch can assign. Requires `drivers:read`.
   *
   * `onShiftOnly` filters to drivers who are **on shift**, which is not the
   * same as free — and the difference matters. It used to also send
   * `isAvailable=true`, which was right while a driver could hold exactly one
   * job; a busy driver can now be given another drop, so that filter hid the
   * person already riding to that street and left the counter reading "no
   * available drivers" with three drivers out.
   */
  drivers(options: { onShiftOnly?: boolean } = {}): Promise<Paginated<Driver>> {
    const params = new URLSearchParams({ limit: '100' });
    if (options.onShiftOnly) {
      params.set('isOnline', 'true');
    }
    return this.http.request(`/drivers?${params.toString()}`);
  }

  /** Assigns a driver to a delivery. Moves the delivery and its order together. */
  assignDriver(deliveryId: string, driverId: string): Promise<Delivery> {
    return this.http.request(`/deliveries/${deliveryId}/assign`, {
      method: 'POST',
      body: { driverId },
    });
  }

  /**
   * Takes a delivery back off its driver and returns it to the pool. Only
   * before pickup — after that the food is in the car and the driver reports a
   * failed delivery instead.
   */
  unassignDriver(deliveryId: string, reason?: string): Promise<Delivery> {
    return this.http.request(`/deliveries/${deliveryId}/unassign`, {
      method: 'POST',
      body: reason ? { reason } : {},
    });
  }

  // --- Order lookup (orders:read, branch-isolated) ---------------------------
  /**
   * Finds past orders for this branch — the counter's answer to "a customer is
   * on the phone about an order".
   *
   * `search` matches the order's 12-digit reference, its branch order number or
   * the customer's phone. The server narrows every result to the caller's own
   * branch, so this can never surface another branch's order however precise
   * the search term is.
   */
  searchOrders(branchId: string, search?: string, status?: OrderStatus): Promise<Paginated<KitchenOrder>> {
    const params = new URLSearchParams({ branchId, limit: '30' });
    if (search && search.trim()) {
      params.set('search', search.trim());
    }
    if (status) {
      params.set('status', status);
    }
    return this.http.request(`/orders?${params.toString()}`);
  }

  /** One order in full, for the lookup drill-down. Branch-checked server-side. */
  order(id: string): Promise<KitchenOrder> {
    return this.http.request(`/orders/${encodeURIComponent(id)}`);
  }

  // --- Branch availability (menu:availability, branch-isolated) --------------
  /**
   * Marks a product sold out (or back on) **for this branch only**.
   *
   * The catalogue itself is organisation-wide and stays owner-owned; this
   * writes the branch's own availability row, which is exactly the permission
   * (`menu:availability`) a branch admin and a kitchen user already hold. The
   * price override is deliberately not exposed here — a branch changing prices
   * at the counter is an owner decision, not a service-time one.
   */
  setProductAvailability(
    branchId: string,
    productId: string,
    isAvailable: boolean,
    /**
     * When a temporary stock-out ends, as an ISO-8601 instant. The backend
     * puts the item back on sale by itself once it passes — a branch that has
     * to remember to switch every item back on will not. Null (or omitted)
     * means "off until someone switches it back", which is a real state and
     * not a missing value.
     */
    unavailableUntil?: string | null,
  ): Promise<unknown> {
    return this.http.request(
      `/menu/branches/${encodeURIComponent(branchId)}/products/${encodeURIComponent(productId)}/availability`,
      {
        method: 'PATCH',
        // priceOverrideMinor is deliberately NOT sent. Omitting it leaves the
        // branch's price alone; sending null would clear it, and a sold-out
        // toggle has no business changing a price.
        body: { isAvailable, ...(unavailableUntil ? { unavailableUntil } : {}) },
      },
    );
  }

  // --- Reports (reports:read, branch-isolated) ------------------------------
  /**
   * The reporting window every report takes.
   *
   * `from`/`to` are **inclusive ISO-8601 instants**, and they are built from
   * local calendar days by `util/reportRange.ts` — see the note there about why
   * a UTC day is the wrong window for a branch's own "today".
   *
   * `branchId` is sent even though the server would scope the read to this
   * branch anyway. It is not the guard — `resolveRequestedBranches` is, exactly
   * as on every other read here — but naming the branch means a terminal signed
   * in with an account that happens to reach two branches reports on the one in
   * its banner rather than quietly summing both.
   */
  salesReport(window: ReportWindowQuery): Promise<SalesReport> {
    return this.http.request(`/reports/sales?${reportQuery(window)}`);
  }

  vatReport(window: ReportWindowQuery): Promise<VatReport> {
    return this.http.request(`/reports/vat?${reportQuery(window)}`);
  }

  paymentsReport(window: ReportWindowQuery): Promise<PaymentsReport> {
    return this.http.request(`/reports/payments?${reportQuery(window)}`);
  }

  /** Average prep and delivery times over the same window. */
  reportKpis(window: ReportWindowQuery): Promise<ReportKpis> {
    return this.http.request(`/reports/dashboard-kpis?${reportQuery(window)}`);
  }

  // --- Queues (orders:kitchen, branch-isolated) -----------------------------
  kitchenQueue(branchId: string): Promise<KitchenOrder[]> {
    return this.http.request(`/orders/kitchen/queue?branchId=${encodeURIComponent(branchId)}`);
  }

  awaitingQueue(branchId: string): Promise<KitchenOrder[]> {
    return this.http.request(`/orders/awaiting-acceptance/queue?branchId=${encodeURIComponent(branchId)}`);
  }

  // --- Fulfilment transitions ----------------------------------------------
  accept(id: string): Promise<KitchenOrder> {
    return this.http.request(`/orders/${id}/accept`, { method: 'POST' });
  }

  reject(id: string, reason: string): Promise<KitchenOrder> {
    return this.http.request(`/orders/${id}/reject`, { method: 'POST', body: { reason } });
  }

  markPreparing(id: string): Promise<KitchenOrder> {
    return this.http.request(`/orders/${id}/preparing`, { method: 'POST' });
  }

  markReady(id: string): Promise<KitchenOrder> {
    return this.http.request(`/orders/${id}/ready`, { method: 'POST' });
  }

  completePickup(id: string): Promise<KitchenOrder> {
    return this.http.request(`/orders/${id}/complete-pickup`, { method: 'POST' });
  }
}
