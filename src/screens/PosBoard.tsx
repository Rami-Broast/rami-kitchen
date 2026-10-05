import React, { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/http';
import { Delivery, KitchenOrder } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { AssignDriverModal } from '../components/AssignDriverModal';
import { ErrorBanner, Grid, Modal, SectionTitle } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { getPrinterConfig, hasPrinted, printAndRecord, profileFor } from '../print/printer';
import { RealtimeEvent, useRealtimeReload } from '../realtime/RealtimeProvider';
import { OrderTicketKind, buildTicket, columnsFor } from '../print/tickets';
import { docketLogo, docketTemplate } from '../print/template';
import { formatSar, minutesSince } from '../util/money';
import { diagnoseForbidden } from '../util/permissionDiagnosis';

const POLL_MS = 8000;

/**
 * The pushes this board reacts to.
 *
 * `order.awaiting` is a new order arriving in the New Orders column;
 * `order.transitioned` covers every later move, including one made on another
 * terminal at the same counter — two staff working the same board should not
 * see different states of it.
 *
 * Module-scoped because a new array each render would re-bind the listeners on
 * every render.
 */
const REALTIME_EVENTS: RealtimeEvent[] = [
  'order.awaiting',
  'order.transitioned',
  // The board now dispatches drivers itself, so it has to track the delivery
  // side too: an assignment made on the Deliveries screen, in the admin panel
  // or on the other counter terminal must take the Assign button off this card
  // rather than leave two people dispatching the same order.
  'delivery.assigned',
  'delivery.unassigned',
];
const REJECT_REASONS = [
  'Restaurant too busy',
  'Item unavailable',
  'Branch closed',
  'Delivery unavailable',
  'Other',
];

interface Preview {
  order: KitchenOrder;
  kind: OrderTicketKind;
  content: string;
  ok: boolean;
  error?: string;
  already: boolean;
}

/** The branch's live order board: new orders to accept/reject, and the kitchen queue. */
export function PosBoard(): React.JSX.Element {
  const { api, actor, branchId } = useAuth();
  const { t } = useLang();
  const [awaiting, setAwaiting] = useState<KitchenOrder[]>([]);
  const [queue, setQueue] = useState<KitchenOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rejecting, setRejecting] = useState<KitchenOrder | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * Deliveries still waiting for a driver, keyed by their order.
   *
   * The kitchen queue stops at READY — the moment a driver is assigned the
   * order becomes DRIVER_ASSIGNED and leaves this board for the Deliveries
   * screen. So the only delivery state the board ever needs is "nobody is
   * carrying this yet", which is one filtered request rather than the branch's
   * whole delivery history.
   */
  const [unassigned, setUnassigned] = useState<Record<string, Delivery>>({});
  const [assigning, setAssigning] = useState<{ order: KitchenOrder; delivery: Delivery } | null>(
    null,
  );

  /**
   * Turns a failure into something the counter can act on.
   *
   * A bare "You do not have permission to perform this action" names no
   * account, no permission and no remedy, so the only way to resolve it is for
   * someone with database access to go looking. The signed-in account's own
   * roles and permissions are already here from `/auth/me`, so the banner can
   * say which permission is missing — an owner then fixes it in Admin → Users —
   * or say that nothing is missing, which is a different fault and worth
   * knowing straight away rather than after an hour of re-assigning roles.
   */
  const describe = useCallback(
    (e: unknown): string => {
      if (!(e instanceof ApiError)) {
        return t('couldNotLoad');
      }

      if (e.statusCode !== 403) {
        return e.message;
      }

      const who = actor?.email ?? actor?.fullName ?? '';
      const roles = actor?.roles?.length ? actor.roles.join(', ') : t('noRole');
      const { missing, unexplained } = diagnoseForbidden('board', actor?.permissions);

      if (unexplained) {
        return `${e.message} ${t('permsLookRight')} (${who} · ${roles})`;
      }

      return `${e.message} ${t('permsMissing')}: ${missing.join(', ')} — ${who} · ${roles}. ${t('permsFix')}`;
    },
    [actor, t],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!branchId) return;
    try {
      const [a, q] = await Promise.all([api.awaitingQueue(branchId), api.kitchenQueue(branchId)]);
      setAwaiting(a);
      setQueue(q);
      setError(null);
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoaded(true);
    }

    // Deliberately separate, and deliberately soft. The queues are what this
    // screen exists for; the driver hand-off is an addition to it. An account
    // that cannot read deliveries (or a request that just failed) must lose the
    // Assign button, not the list of food to cook — so this failure never
    // reaches the banner and never blocks the queues above.
    try {
      const res = await api.deliveries(branchId, 'PENDING_ASSIGNMENT');
      setUnassigned(Object.fromEntries(res.data.map((d) => [d.orderId, d])));
    } catch {
      setUnassigned({});
    }
  }, [api, branchId, describe]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Realtime on top of the poll, not instead of it. A new order pushed by the
  // server lands on the board immediately rather than up to POLL_MS later,
  // which on this screen is a customer's order sitting unseen while the counter
  // is looking straight at it. The interval above stays as the floor: a counter
  // terminal on a flaky shop network must still show the orders it has to cook.
  // The hook also refreshes once on every reconnect, covering whatever the
  // socket missed while it was down.
  useRealtimeReload(REALTIME_EVENTS, refresh);

  // Whether accepting also prints the kitchen ticket is a branch setting: a
  // branch with the printer beside the counter wants one press, one whose
  // printer is in the kitchen may want to accept first and print when the line
  // is ready. Read per render so a change in Print settings takes effect
  // without a reload.
  const autoPrintKitchen = getPrinterConfig().autoPrintKitchenOnAccept;

  const print = useCallback(
    async (order: KitchenOrder, kind: OrderTicketKind, force: boolean): Promise<void> => {
      // The ticket is built to the width of the device it is going to, so a
      // 58mm roll does not wrap every line and lose the quantity off the front.
      const config = getPrinterConfig();
      const profile = profileFor(config, kind);
      const content = buildTicket(kind, order, columnsFor(profile.paperWidth), docketTemplate());
      // Only the customer's copy carries the brand; the kitchen ticket is the
      // branch's own working document and a logo on it is ink and seconds.
      const logoBase64 = kind === 'docket' ? await docketLogo(profile.paperWidth) : null;

      if (!force && hasPrinted(order.id, kind)) {
        setPreview({ order, kind, content, ok: true, already: true });
        return;
      }

      const result = await printAndRecord(
        { kind, orderId: order.id, orderNumber: order.orderNumber, content, logoBase64 },
        config,
      );

      setPreview({ order, kind, content, ok: result.ok, error: result.error, already: false });
    },
    [],
  );

  /**
   * Opens the driver picker for an order that has just become READY.
   *
   * This is the whole point of dispatching from the board: marking a delivery
   * order ready and choosing who carries it are one act at the counter, and
   * splitting them across two screens is what had staff finishing the food and
   * then forgetting the second half until a customer rang.
   *
   * The delivery is fetched directly rather than read out of `unassigned`,
   * because that state is set by `refresh` and React has not committed it yet
   * when this runs. The backend opens the delivery row inside the same
   * transaction as the READY transition, so by the time the transition has
   * returned the row exists.
   *
   * Silent on failure, like the board's other delivery read: the order **is**
   * ready either way, and the Assign driver button on the card is the way back
   * in. A dialog that failed to open must not also lose the transition.
   */
  const promptAssign = useCallback(
    async (order: KitchenOrder): Promise<void> => {
      if (order.type !== 'DELIVERY' || !branchId) {
        return;
      }
      try {
        const res = await api.deliveries(branchId, 'PENDING_ASSIGNMENT');
        const delivery = res.data.find((d) => d.orderId === order.id);
        if (delivery) {
          setAssigning({ order, delivery });
        }
      } catch {
        // See above — the card's button remains.
      }
    },
    [api, branchId],
  );

  /**
   * Runs a transition, refreshes, then does whatever that transition implies.
   *
   * `after` is what makes one press do the whole job — printing the kitchen
   * ticket on accept, asking who is carrying it on ready. It runs after the
   * refresh so the board is already correct behind whatever it opens.
   */
  const act = useCallback(
    async (
      order: KitchenOrder,
      fn: () => Promise<unknown>,
      after?: (order: KitchenOrder) => Promise<void>,
    ): Promise<void> => {
      setBusyId(order.id);
      try {
        await fn();
        await refresh();
        if (after) {
          await after(order);
        }
      } catch (e) {
        setError(describe(e));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, describe],
  );

  const doReject = async (reason: string): Promise<void> => {
    if (!rejecting) return;
    const order = rejecting;
    setRejecting(null);
    await act(order, () => api.reject(order.id, reason));
  };

  if (!branchId) {
    return <NoBranch />;
  }

  return (
    <>
      {error ? <ErrorBanner message={error} onRetry={refresh} retryLabel={t('retry')} /> : null}

      <section>
        <SectionTitle count={awaiting.length}>{t('newOrders')}</SectionTitle>
        {awaiting.length === 0 ? (
          <p className="muted">{t('noneWaiting')}</p>
        ) : (
          <Grid>
            {awaiting.map((o) => (
              <OrderCard key={o.id} order={o} highlight>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn"
                    disabled={busyId === o.id}
                    onClick={() =>
                      act(
                        o,
                        () => api.accept(o.id),
                        autoPrintKitchen ? (ord) => print(ord, 'kitchen', false) : undefined,
                      )
                    }
                  >
                    {autoPrintKitchen ? t('acceptPrint') : t('accept')}
                  </button>
                  <button
                    className="btn danger"
                    disabled={busyId === o.id}
                    onClick={() => setRejecting(o)}
                  >
                    {t('reject')}
                  </button>
                </div>
              </OrderCard>
            ))}
          </Grid>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <SectionTitle count={queue.length}>{t('kitchenQueue')}</SectionTitle>
        {!loaded ? (
          <p className="muted">{t('loading')}</p>
        ) : queue.length === 0 ? (
          <p className="muted">{t('nothingCooking')}</p>
        ) : (
          <Grid>
            {queue.map((o) => (
              <OrderCard key={o.id} order={o}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {o.status === 'CONFIRMED' ? (
                    <button
                      className="btn"
                      disabled={busyId === o.id}
                      onClick={() => act(o, () => api.markPreparing(o.id))}
                    >
                      {t('startPreparing')}
                    </button>
                  ) : null}
                  {o.status === 'PREPARING' ? (
                    <button
                      className="btn"
                      disabled={busyId === o.id}
                      // One press: the food is ready and the counter is asked
                      // who is taking it, on this screen, without going to
                      // Deliveries and finding the order again.
                      onClick={() => act(o, () => api.markReady(o.id), promptAssign)}
                    >
                      {t('markReady')}
                    </button>
                  ) : null}
                  {o.status === 'READY' && o.type === 'PICKUP' ? (
                    <button
                      className="btn"
                      disabled={busyId === o.id}
                      onClick={() => act(o, () => api.completePickup(o.id))}
                    >
                      {t('completePickup')}
                    </button>
                  ) : null}
                  {/* The hand-off, on the card the cook just pressed Ready on.
                      This used to be a dead "Awaiting driver" pill: the counter
                      had to leave the board, find the order again in the
                      Deliveries list and assign from there — during service,
                      with the food already on the pass. Assigning here moves
                      the order to DRIVER_ASSIGNED, which takes it off this
                      board and onto the Deliveries screen, so the card
                      disappearing is the confirmation. */}
                  {o.status === 'READY' && o.type === 'DELIVERY' ? (
                    (() => {
                      const pending = unassigned[o.id];
                      return pending ? (
                        <button
                          className="btn brand"
                          disabled={busyId === o.id}
                          onClick={() => setAssigning({ order: o, delivery: pending })}
                        >
                          {t('assignNow')}
                        </button>
                      ) : (
                        // Two different reasons to be here, and the card must
                        // not claim to know which: the delivery row is opened
                        // by the backend as the order reaches READY, so for one
                        // poll it may not be listed yet; or it is already
                        // assigned and this card is about to leave the board.
                        <span
                          className="pill"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
                        >
                          {t('awaitingDriver')}
                        </span>
                      );
                    })()
                  ) : null}
                  <button className="btn secondary" onClick={() => print(o, 'kitchen', false)}>
                    {t('kitchenTicket')}
                  </button>
                  <button className="btn secondary" onClick={() => print(o, 'docket', false)}>
                    {t('docket')}
                  </button>
                </div>
              </OrderCard>
            ))}
          </Grid>
        )}
      </section>

      {assigning ? (
        <AssignDriverModal
          delivery={assigning.delivery}
          title={`${t('assignDriver')} · ${assigning.order.orderNumber}`}
          onClose={() => setAssigning(null)}
          onAssigned={async () => {
            setAssigning(null);
            await refresh();
          }}
        />
      ) : null}

      {rejecting ? (
        <Modal title={`${t('reject')} ${rejecting.orderNumber}`} onClose={() => setRejecting(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            Choose a reason — the customer is told the order was rejected.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {REJECT_REASONS.map((r) => (
              <button key={r} className="btn secondary" onClick={() => doReject(r)}>
                {r}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}

      {preview ? (
        <Modal
          title={`${preview.kind === 'kitchen' ? t('kitchenTicket') : t('docket')} · ${preview.order.orderNumber}`}
          onClose={() => setPreview(null)}
        >
          {preview.already ? (
            <p style={{ marginTop: 0, color: 'var(--warning)' }}>
              Already printed. Use reprint only if the ticket was lost.
            </p>
          ) : preview.ok ? (
            <p style={{ marginTop: 0, color: 'var(--success)' }}>
              {getPrinterConfig().adapter === 'mock'
                ? 'Preview (no printer configured):'
                : 'Sent to the printer.'}
            </p>
          ) : (
            <p style={{ marginTop: 0, color: 'var(--danger)' }}>{preview.error ?? 'Printing failed.'}</p>
          )}
          <pre
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              overflowX: 'auto',
              fontSize: 12,
              whiteSpace: 'pre',
            }}
          >
            {preview.content}
          </pre>
          <button className="btn secondary" onClick={() => print(preview.order, preview.kind, true)}>
            Reprint
          </button>
        </Modal>
      ) : null}
    </>
  );
}

function NoBranch(): React.JSX.Element {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>No branch assigned</h3>
      <p className="muted" style={{ margin: 0 }}>
        This account isn’t assigned to a branch, so there’s no order queue to show. Ask an owner to
        assign your staff account to a branch.
      </p>
    </div>
  );
}

function OrderCard({
  order,
  highlight,
  children,
}: {
  order: KitchenOrder;
  highlight?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const age = minutesSince(order.placedAt);
  const isNew = age < 2;
  return (
    <div
      className="card tile"
      style={
        {
          // The stripe carries meaning or it carries nothing. An order waiting
          // to be accepted is amber; one already cooking is quiet. Every card
          // used to be brand magenta, which told a cook nothing at all.
          '--tile-accent': highlight ? 'var(--warning)' : 'var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        } as React.CSSProperties
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span>
          <strong style={{ fontSize: 16 }}>{order.orderNumber}</strong>
          {order.referenceId ? (
            // Order numbers repeat across branches; this is the number a
            // customer quotes on the phone, so the counter needs to see it.
            <span className="muted mono" style={{ fontSize: 11, display: 'block' }}>
              {order.referenceId}
            </span>
          ) : null}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isNew ? (
            <span className="pill tone-new">NEW</span>
          ) : null}
          <span className="pill tone-quiet">{order.type}</span>
          <span className="muted mono" style={{ fontSize: 12 }}>
            {age}m
          </span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {order.items.map((it) => (
          <div key={it.id} style={{ fontSize: 14 }}>
            <span className="mono">{it.quantity}×</span>{' '}
            {it.variantName ? `${it.productName} (${it.variantName})` : it.productName}
            {(it.modifiers ?? []).map((m) => (
              <div key={m.id} className="muted" style={{ fontSize: 12, paddingInlineStart: 18 }}>
                + {m.addonName}
              </div>
            ))}
          </div>
        ))}
      </div>
      {order.customerNotes ? (
        <div style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px' }}>
          <b>Note:</b> {order.customerNotes}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {order.status.replace(/_/g, ' ').toLowerCase()}
        </span>
        <span className="muted mono" style={{ fontSize: 13 }}>
          {formatSar(order.totalMinor)}
        </span>
      </div>
      {children}
    </div>
  );
}
