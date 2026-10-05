import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/http';
import { BranchMenu, MenuProduct } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ErrorBanner, Field, SectionTitle } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { formatSar } from '../util/money';
import { describeReturn, SOLD_OUT_OPTIONS, soldOutUntil } from '../util/soldOutWindow';

/**
 * Branch menu availability — "we've run out of the lamb".
 *
 * The catalogue itself is organisation-wide and stays the owner's; what this
 * screen writes is only the branch's own availability row, which is exactly
 * what the `menu:availability` permission a branch admin and a kitchen user
 * already hold covers. The branch is never sent from here — the server takes it
 * from the signed-in actor's scope and checks it — so this cannot reach another
 * branch's menu.
 *
 * Price overrides are deliberately not offered. Changing what a dish costs is
 * an owner decision made in the admin app, not something to do at the counter
 * mid-service.
 */
export function MenuAvailabilityScreen(): React.JSX.Element {
  const { api, branchId } = useAuth();
  const { t, name, dir } = useLang();

  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  /** Product ids with a save in flight, so a row can't be double-toggled. */
  const [saving, setSaving] = useState<Set<string>>(new Set());
  // Which product's "how long?" row is open. One at a time — a counter with
  // four open pickers is a counter about to press the wrong one.
  const [choosing, setChoosing] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!branchId) return;
    try {
      setMenu(await api.branchMenu(branchId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotLoad'));
    } finally {
      setLoaded(true);
    }
  }, [api, branchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    if (!menu) {
      return [];
    }
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return menu.categories;
    }
    return menu.categories
      .map((category) => ({
        ...category,
        products: category.products.filter((product) =>
          [product.name, product.nameAr ?? ''].some((value) => value.toLowerCase().includes(needle)),
        ),
      }))
      .filter((category) => category.products.length > 0);
  }, [menu, filter]);

  if (!branchId) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          This account isn’t assigned to a branch, so menu availability can’t be set here.
        </p>
      </div>
    );
  }

  const toggle = async (
    product: MenuProduct,
    next: boolean,
    unavailableUntil?: string | null,
  ): Promise<void> => {
    setSaving((prev) => new Set(prev).add(product.id));
    setSaveError(null);
    setChoosing(null);

    // Optimistic: a counter toggle must feel instant. On failure the row is put
    // back exactly as it was, so the screen never claims a state the server
    // did not accept.
    setMenu((prev) =>
      prev ? applyAvailability(prev, product.id, next, unavailableUntil ?? null) : prev,
    );

    try {
      await api.setProductAvailability(branchId, product.id, next, unavailableUntil);
    } catch (e) {
      setMenu((prev) =>
        prev
          ? applyAvailability(
              prev,
              product.id,
              product.isAvailable,
              product.unavailableUntil ?? null,
            )
          : prev,
      );
      setSaveError(e instanceof ApiError ? e.message : t('couldNotSave'));
    } finally {
      setSaving((prev) => {
        const copy = new Set(prev);
        copy.delete(product.id);
        return copy;
      });
    }
  };

  const soldOutCount = (menu?.categories ?? [])
    .flatMap((category) => category.products)
    .filter((product) => !product.isAvailable).length;

  return (
    <div>
      <SectionTitle>{t('menuTitle')}</SectionTitle>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('menuHint')}
      </p>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {saveError ? <ErrorBanner message={saveError} /> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <Field label={t('filterItems')} htmlFor="menu-filter">
          <input
            id="menu-filter"
            className="input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
          />
        </Field>
        {soldOutCount > 0 ? (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {soldOutCount} · {t('soldOut')}
          </p>
        ) : null}
      </div>

      {loaded && categories.length === 0 ? <p className="muted">{t('noMatches')}</p> : null}

      {categories.map((category) => (
        <div key={category.id} style={{ marginBottom: 16 }}>
          <SectionTitle>{name(category)}</SectionTitle>
          <div style={{ display: 'grid', gap: 8 }}>
            {category.products.map((product) => (
              <div
                key={product.id}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  flexWrap: 'wrap',
                  opacity: product.isAvailable ? 1 : 0.6,
                }}
              >
                <div style={{ flex: 1, minWidth: 160, textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                  <div style={{ fontWeight: 700 }}>{name(product)}</div>
                  <div className="muted mono" style={{ fontSize: 13 }}>
                    {formatSar(product.priceMinor)}
                  </div>
                </div>
                <span
                  className="pill"
                  style={{
                    background: product.isAvailable ? 'var(--success)' : 'var(--danger)',
                    color: '#fff',
                  }}
                >
                  {product.isAvailable ? t('available') : t('soldOut')}
                </span>
                <button
                  className={product.isAvailable ? 'btn ghost' : 'btn'}
                  onClick={() =>
                    product.isAvailable
                      ? // Going off asks how long. Coming back does not — an
                        // item someone is switching back on is available now.
                        setChoosing(product.id)
                      : void toggle(product, true)
                  }
                  disabled={saving.has(product.id)}
                >
                  {product.isAvailable ? t('markSoldOut') : t('markAvailable')}
                </button>

                {/* While it is off, say when it comes back — or say plainly
                    that nothing will bring it back but a person, which is a
                    real state and not a missing value. */}
                {!product.isAvailable ? (
                  <div
                    className="muted"
                    style={{ flexBasis: '100%', fontSize: 13, marginTop: 2 }}
                  >
                    {returnNote(product.unavailableUntil, t)}
                  </div>
                ) : null}

                {choosing === product.id ? (
                  <div style={{ flexBasis: '100%', marginTop: 8 }}>
                    <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                      {t('soldOutFor')}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {SOLD_OUT_OPTIONS.map((option) => (
                        <button
                          key={option.duration}
                          className="btn ghost"
                          onClick={() => void toggle(product, false, soldOutUntil(option.duration))}
                          disabled={saving.has(product.id)}
                        >
                          {t(option.labelKey)}
                        </button>
                      ))}
                      <button className="btn ghost" onClick={() => setChoosing(null)}>
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Returns the menu with one product's availability replaced.
 *
 * Pure and exported so the optimistic update and its rollback are the same
 * operation run twice, and so it can be tested without a component.
 */
export function applyAvailability(
  menu: BranchMenu,
  productId: string,
  isAvailable: boolean,
  unavailableUntil: string | null = null,
): BranchMenu {
  return {
    ...menu,
    categories: menu.categories.map((category) => ({
      ...category,
      products: category.products.map((product) =>
        product.id === productId
          ? { ...product, isAvailable, unavailableUntil: isAvailable ? null : unavailableUntil }
          : product,
      ),
    })),
  };
}

/**
 * What a sold-out card says about coming back.
 *
 * Deliberately vague past an hour or so: a counter does not need "back in 247
 * minutes", and the exact instant is not something anyone is going to hold us
 * to. What matters is the difference between "back shortly", "back later
 * today" and "not until someone does something".
 */
function returnNote(
  unavailableUntil: string | null | undefined,
  t: (key: string) => string,
): string {
  const info = describeReturn(unavailableUntil);

  if (info === null) {
    return t('offUntilSwitchedBack');
  }

  if (info.minutes <= 90) {
    return `${t('backInMinutes')} ${info.minutes} ${t('minutesShort')}`;
  }

  return t('backLater');
}
