import React, { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/http';
import { KitchenOrder } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ErrorBanner, Field, Modal, SectionTitle } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { buildTicket, columnsFor } from '../print/tickets';
import { docketLogo, docketTemplate } from '../print/template';
import { getPrinterConfig, printAndRecord, profileFor } from '../print/printer';
import { formatSar } from '../util/money';

/**
 * Order lookup — the counter's answer to "a customer is on the phone about an
 * order".
 *
 * The board only ever shows what is live right now, so until this screen
 * existed a branch had no way to find an order once it left the queues. The
 * docket prints the order's 12-digit reference precisely so a customer can read
 * it back, and this is where that number is used.
 *
 * The search runs on the server, which narrows every result to the caller's own
 * branch before matching. That is the isolation boundary — this screen is a
 * client of it, never a substitute for it, so a reference belonging to another
 * branch simply returns nothing.
 */
export function LookupScreen(): React.JSX.Element {
  const { api, branchId } = useAuth();
  const { t, dir } = useLang();

  const [term, setTerm] = useState('');
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [viewing, setViewing] = useState<KitchenOrder | null>(null);

  const run = useCallback(
    async (search: string): Promise<void> => {
      if (!branchId) return;
      setLoading(true);
      try {
        const res = await api.searchOrders(branchId, search);
        setOrders(res.data);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t('couldNotLoad'));
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    },
    [api, branchId, t],
  );

  // Land on the branch's most recent orders, so the screen is useful before
  // anyone types anything — most calls are about something placed just now.
  useEffect(() => {
    run('');
  }, [run]);

  if (!branchId) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          This account isn’t assigned to a branch, so orders can’t be looked up here.
        </p>
      </div>
    );
  }

  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    run(term);
  };

  return (
    <div>
      <SectionTitle>{t('lookupTitle')}</SectionTitle>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('lookupHint')}
      </p>

      <form onSubmit={onSubmit} className="card" style={{ marginBottom: 12 }}>
        <Field label={t('search')} htmlFor="order-search">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              id="order-search"
              className="input mono"
              style={{ flex: 1, minWidth: 200 }}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('lookupPlaceholder')}
              // Numeric on a counter tablet: references, order numbers and
              // phones are all digits.
              inputMode="numeric"
              autoComplete="off"
            />
            <button className="btn" type="submit" disabled={loading}>
              {loading ? t('loading') : t('search')}
            </button>
            {term ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setTerm('');
                  run('');
                }}
              >
                {t('clear')}
              </button>
            ) : null}
          </div>
        </Field>
      </form>

      {error ? <ErrorBanner message={error} onRetry={() => run(term)} /> : null}

      <SectionTitle>{term.trim() ? t('lookupTitle') : t('recentOrders')}</SectionTitle>

      {loaded && orders.length === 0 && !error ? (
        <p className="muted">{t('noMatches')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {orders.map((order) => (
            <button
              key={order.id}
              className="card"
              onClick={() => setViewing(order)}
              style={{ textAlign: dir === 'rtl' ? 'right' : 'left', cursor: 'pointer', padding: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  <strong style={{ fontSize: 16 }}>{order.orderNumber}</strong>
                  {order.referenceId ? (
                    <span className="muted mono" style={{ fontSize: 11, display: 'block' }}>
                      {order.referenceId}
                    </span>
                  ) : null}
                </span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="pill" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    {order.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <strong className="mono">{formatSar(order.totalMinor)}</strong>
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {new Date(order.placedAt).toLocaleString()}
                {order.customer?.phone ? ` · ${order.customer.phone}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      {viewing ? <OrderDetail order={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

/**
 * A found order in full, with reprint.
 *
 * Reprint deliberately bypasses the duplicate-print guard: the whole reason
 * someone is on this screen is that the original ticket was lost, spilled on or
 * never came out. The print is still recorded in the log, so a reprint is
 * visible rather than silent.
 */
function OrderDetail({ order, onClose }: { order: KitchenOrder; onClose: () => void }): React.JSX.Element {
  const { t } = useLang();
  const [printError, setPrintError] = useState<string | null>(null);
  const [printed, setPrinted] = useState<string | null>(null);

  const reprint = async (kind: 'kitchen' | 'docket'): Promise<void> => {
    const config = getPrinterConfig();
    const profile = profileFor(config, kind);
    const content = buildTicket(kind, order, columnsFor(profile.paperWidth), docketTemplate());
    const logoBase64 = kind === 'docket' ? await docketLogo(profile.paperWidth) : null;

    const result = await printAndRecord(
      { kind, orderId: order.id, orderNumber: order.orderNumber, content, logoBase64 },
      config,
    );

    setPrintError(result.ok ? null : (result.error ?? t('couldNotSave')));
    setPrinted(result.ok ? kind : null);
  };

  return (
    <Modal title={`${order.orderNumber} · ${order.type}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 8 }}>
        {order.referenceId ? (
          <Row label={t('reference')} value={<code className="mono">{order.referenceId}</code>} />
        ) : null}
        <Row label={t('placed')} value={new Date(order.placedAt).toLocaleString()} />
        <Row label={t('status')} value={order.status.replace(/_/g, ' ').toLowerCase()} />
        {order.paymentStatus ? (
          <Row label={t('payment')} value={order.paymentStatus.replace(/_/g, ' ').toLowerCase()} />
        ) : null}
        {order.customer ? (
          <Row
            label={t('customer')}
            value={[order.customer.fullName, order.customer.phone].filter(Boolean).join(' · ')}
          />
        ) : null}

        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

        {order.items.map((item) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {item.quantity}× {item.productName}
              {item.variantName ? ` (${item.variantName})` : ''}
            </span>
          </div>
        ))}

        {order.customerNotes ? (
          <p className="muted" style={{ margin: 0 }}>
            {order.customerNotes}
          </p>
        ) : null}

        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong>{t('total')}</strong>
          <strong className="mono">{formatSar(order.totalMinor)}</strong>
        </div>

        {printError ? <ErrorBanner message={printError} /> : null}
        {printed ? (
          <p className="muted" style={{ margin: 0 }}>
            ✓ {printed === 'kitchen' ? t('kitchenTicket') : t('docket')}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => reprint('docket')}>
            {t('reprint')}
          </button>
          <button className="btn ghost" onClick={() => reprint('kitchen')}>
            {t('reprintKitchen')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
