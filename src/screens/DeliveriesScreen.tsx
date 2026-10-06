import React, { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/http';
import { Delivery, DeliveryStatus } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { AssignDriverModal } from '../components/AssignDriverModal';
import { ErrorBanner, Grid, SectionTitle } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { RealtimeEvent, useRealtimeReload } from '../realtime/RealtimeProvider';
import { minutesSince } from '../util/money';

const POLL_MS = 8000;

/**
 * `delivery.assigned` fires when a driver is put on a delivery — including from
 * the admin panel, so a counter watching this list sees the assignment without
 * waiting out the poll. `order.transitioned` covers the driver's own moves
 * (picked up, out for delivery, delivered), which is what changes the status
 * shown against each row.
 *
 * Module-scoped so the listener bindings are stable across renders.
 */
const REALTIME_EVENTS: RealtimeEvent[] = [
  'delivery.assigned',
  'delivery.unassigned',
  'order.transitioned',
];

/** Status → pill colour, so an at-a-glance board reads by colour, not just text. */
const STATUS_COLOR: Record<DeliveryStatus, string> = {
  PENDING_ASSIGNMENT: 'var(--warning)',
  ASSIGNED: 'var(--accent)',
  PICKED_UP: 'var(--accent)',
  OUT_FOR_DELIVERY: 'var(--accent)',
  DELIVERED: 'var(--success)',
  FAILED: 'var(--danger)',
  CANCELLED: 'var(--text-muted)',
};

/**
 * The branch's deliveries and assigned drivers.
 *
 * Read-only display plus one action — assigning a driver to a delivery that
 * still needs one. Everything is branch-isolated on the server: the list is
 * restricted to the caller's own branch, and a driver assignment is checked
 * against it too. The customer's phone number is never exposed here (the backend
 * doesn't send it); staff see the drop-off address and the driver's name only.
 */
export function DeliveriesScreen(): React.JSX.Element {
  const { api, branchId } = useAuth();
  const { t, dir } = useLang();

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [assigning, setAssigning] = useState<Delivery | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!branchId) return;
    try {
      const res = await api.deliveries(branchId);
      setDeliveries(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotLoad'));
    } finally {
      setLoaded(true);
    }
  }, [api, branchId, t]);

  /**
   * Hands a delivery back to the pool — the driver's shift ended, their phone
   * died, the wrong one was picked. Before this existed the delivery could go
   * to nobody else and the order had to be cancelled.
   */
  const unassign = async (d: Delivery): Promise<void> => {
    try {
      await api.unassignDriver(d.id);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotLoad'));
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Realtime on top of the poll, which stays as the floor. See PosBoard.
  useRealtimeReload(REALTIME_EVENTS, refresh);

  if (!branchId) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          This account isn’t assigned to a branch, so there are no deliveries to show.
        </p>
      </div>
    );
  }

  return (
    <>
      <SectionTitle>
        {t('deliveriesTitle')} {deliveries.length > 0 ? `· ${deliveries.length}` : ''}
      </SectionTitle>
      {error ? <ErrorBanner message={error} onRetry={refresh} retryLabel={t('retry')} /> : null}

      {!loaded ? (
        <p className="muted">{t('loading')}</p>
      ) : deliveries.length === 0 ? (
        <p className="muted">{t('noDeliveries')}</p>
      ) : (
        <Grid>
          {deliveries.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              dir={dir}
              onAssign={() => setAssigning(d)}
              onUnassign={() => void unassign(d)}
            />
          ))}
        </Grid>
      )}

      {assigning ? (
        <AssignDriverModal
          delivery={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={async () => {
            setAssigning(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function DeliveryCard({
  delivery,
  dir,
  onAssign,
  onUnassign,
}: {
  delivery: Delivery;
  dir: 'ltr' | 'rtl';
  onAssign: () => void;
  onUnassign: () => void;
}): React.JSX.Element {
  const { t } = useLang();
  const addr = delivery.addressSnapshot;
  const driver = delivery.driver;
  const age = minutesSince(delivery.createdAt);

  return (
    <div
      className="card"
      style={{
        borderInlineStart: `4px solid ${STATUS_COLOR[delivery.status]}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span>
          <strong style={{ fontSize: 16 }}>{delivery.order?.orderNumber ?? '—'}</strong>
          {delivery.order?.referenceId ? (
            <span className="muted mono" style={{ fontSize: 11, display: 'block' }}>
              {delivery.order.referenceId}
            </span>
          ) : null}
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="pill" style={{ background: STATUS_COLOR[delivery.status], color: '#fff' }}>
            {delivery.status.replace(/_/g, ' ')}
          </span>
          <span className="muted mono" style={{ fontSize: 12 }}>
            {age}m
          </span>
        </span>
      </div>

      {addr ? (
        <div style={{ fontSize: 13 }}>
          <div>{addr.line1}</div>
          <div className="muted">
            {[addr.district, addr.city].filter(Boolean).join(' · ')}
          </div>
          {addr.notes ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {addr.notes}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {t('driver')}:{' '}
          {driver ? (
            <strong style={{ color: 'var(--text)' }}>
              {driver.user.fullName ?? '—'}
              {driver.vehicleType ? <span className="muted"> · {driver.vehicleType}</span> : null}
            </strong>
          ) : (
            <span style={{ color: 'var(--warning)' }}>{t('unassigned')}</span>
          )}
        </span>
        {delivery.status === 'PENDING_ASSIGNMENT' ? (
          <button className="btn" onClick={onAssign} style={{ padding: '6px 12px' }}>
            {t('assignDriver')}
          </button>
        ) : null}
        {/* Only before pickup. Once the food is in the car, where it is is a
            physical fact and the driver reports a failed delivery instead. */}
        {delivery.status === 'ASSIGNED' ? (
          <button className="btn ghost" onClick={onUnassign} style={{ padding: '6px 12px' }}>
            {t('takeBack')}
          </button>
        ) : null}
      </div>
      {/* dir is threaded through so nested flips (if any) follow reading direction */}
      <span hidden aria-hidden dir={dir} />
    </div>
  );
}

