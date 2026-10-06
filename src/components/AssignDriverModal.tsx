import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/http';
import { Delivery, Driver } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ErrorBanner, Modal } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { useRealtimeReload } from '../realtime/RealtimeProvider';
import { loadKey, sortByAvailability } from '../util/driverPicker';

/**
 * Picks a driver and puts them on a delivery.
 *
 * Shared by the order board and the Deliveries screen deliberately: assigning
 * from the board (the moment the food is ready, on the card the cook just
 * pressed Ready on) and assigning from the deliveries list are the same act,
 * and two copies of it would drift — one would learn about a new failure case
 * or a driver field and the other would not.
 *
 * Three things it now gets right that it did not:
 *
 * - **It lists every driver on shift, not only the free ones.** A busy driver
 *   can be given another drop, which is how a small fleet actually runs; asking
 *   the server for `isAvailable=true` hid the person already riding to that
 *   street and left the counter reading "no available drivers" with three
 *   drivers out. What each is carrying is on the row, and the server enforces
 *   the ceiling.
 * - **The list is live.** It used to load once, when the dialog opened. A
 *   driver who started their shift ten seconds later could not appear short of
 *   closing and reopening it — during service, with the food on the pass. It
 *   now reloads on `driver.status` (and on every socket reconnect), so somebody
 *   coming on shift, finishing a drop or stepping away lands in the list while
 *   the counter is looking at it.
 * - **Stacking is confirmed, once.** Giving a second drop to somebody already
 *   out is an ordinary decision, not a slip — so it confirms rather than
 *   refuses, and a free driver is still one press.
 *
 * The server is what enforces every rule here. Availability read a moment ago
 * can be stale by the time Assign is pressed, so the backend claims the driver
 * inside a transaction (behind a row lock, so two counters cannot both squeeze
 * past the ceiling) and this dialog simply reports what it says. Branch
 * isolation is likewise server-side.
 */
export function AssignDriverModal({
  delivery,
  title,
  onClose,
  onAssigned,
}: {
  delivery: Delivery;
  /** Overridden by the board, which knows the order number the card is showing. */
  title?: string;
  onClose: () => void;
  onAssigned: () => void | Promise<void>;
}): React.JSX.Element {
  const { api } = useAuth();
  const { t } = useLang();
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Driver | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.drivers({ onShiftOnly: true });
      setDrivers(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotLoad'));
      setDrivers([]);
    }
  }, [api, t]);

  useEffect(() => {
    load();
  }, [load]);

  // What makes the list live rather than a snapshot. `useRealtimeReload` also
  // fires once on every (re)connect, so a shift that started while the shop
  // network blinked is not missed either.
  useRealtimeReload(['driver.status', 'delivery.assigned', 'delivery.unassigned'], load);

  const ordered = useMemo(() => sortByAvailability(drivers ?? []), [drivers]);

  const assign = async (driverId: string): Promise<void> => {
    setBusyId(driverId);
    setError(null);
    setConfirming(null);
    try {
      await api.assignDriver(delivery.id, driverId);
      await onAssigned();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotAssign'));
      setBusyId(null);
    }
  };

  // A free driver is one press; a busy one asks first. The confirmation is not
  // a warning — it is the counter saying "yes, that one, on purpose".
  const choose = (driver: Driver): void => {
    if (driver.isAvailable) {
      void assign(driver.id);
      return;
    }
    setConfirming(driver);
  };

  const heading = title ?? `${t('assignDriver')} · ${delivery.order?.orderNumber ?? ''}`;

  return (
    <Modal title={heading} onClose={onClose}>
      {error ? <ErrorBanner message={error} onRetry={load} retryLabel={t('retry')} /> : null}
      {drivers === null ? (
        <p className="muted">{t('loading')}</p>
      ) : ordered.length === 0 ? (
        // Named as a cause the counter can act on. An empty box says nothing;
        // "nobody is on shift" means ring somebody.
        <p className="muted">{t('noDriversOnShift')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ordered.map((d) => {
            const load = loadKey(d);
            return (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>
                  {d.user.fullName ?? '—'}
                  {d.vehicleType ? <span className="muted"> · {d.vehicleType}</span> : null}
                  <span className={`pill tone-${d.isAvailable ? 'ok' : 'new'}`} style={{ marginInlineStart: 8 }}>
                    {t(load.key, { n: load.count })}
                  </span>
                </span>
                <button className="btn" disabled={busyId !== null} onClick={() => choose(d)}>
                  {t('assign')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {confirming ? (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 8px' }}>
            {t('stackConfirm')} <strong>{confirming.user.fullName ?? '—'}</strong>
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn brand" onClick={() => void assign(confirming.id)}>
              {t('stackConfirmYes')}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
