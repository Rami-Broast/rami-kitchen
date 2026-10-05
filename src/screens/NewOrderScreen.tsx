import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/http';
import { newIdempotencyKey } from '../util/idempotency';
import {
  BranchMenu,
  CounterOrderInput,
  CounterPaymentMethod,
  MenuAddon,
  MenuProduct,
  MenuVariant,
  OrderType,
  PriceQuote,
} from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ErrorBanner, Field, Modal, SectionTitle } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { formatSar } from '../util/money';

/** One configured line in the counter cart. */
interface CartLine {
  key: string;
  product: MenuProduct;
  variant: MenuVariant | null;
  addons: MenuAddon[];
  quantity: number;
  notes?: string;
}

type PayChoice = 'CASH_NOW' | 'CASH_LATER' | 'COD';

/** Maps a UI pay choice onto the backend's method + collected flag. */
function toPayment(choice: PayChoice): Pick<CounterOrderInput, 'paymentMethod' | 'cashCollected'> {
  if (choice === 'COD') {
    return { paymentMethod: 'CASH_ON_DELIVERY' as CounterPaymentMethod };
  }
  return { paymentMethod: 'CASH' as CounterPaymentMethod, cashCollected: choice === 'CASH_NOW' };
}

function lineKey(product: MenuProduct, variant: MenuVariant | null, addons: MenuAddon[]): string {
  return [product.id, variant?.id ?? '', ...addons.map((a) => a.id).sort()].join('|');
}

/**
 * Counter order entry (Branch POS) — a walk-in / phone order taken by staff.
 *
 * Everything about money is the backend's: menu prices are displayed as sent,
 * the running total comes from the pricing endpoint (never summed here), and the
 * order is priced again server-side on placement. The branch is fixed to the
 * signed-in staff member's own branch.
 */
export function NewOrderScreen({ onPlaced }: { onPlaced: () => void }): React.JSX.Element {
  const { api, branchId, branch } = useAuth();
  const { t, name, dir } = useLang();

  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [configuring, setConfiguring] = useState<MenuProduct | null>(null);

  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  const acceptsDelivery = branch?.settings?.acceptsDelivery ?? true;
  const acceptsPickup = branch?.settings?.acceptsPickup ?? true;
  const acceptsCod = branch?.settings?.acceptsCashOnDelivery ?? false;

  const [type, setType] = useState<OrderType>('PICKUP');
  const [addr, setAddr] = useState({ line1: '', city: '', district: '', notes: '' });
  const [pay, setPay] = useState<PayChoice>('CASH_NOW');
  // One key per order being built, deliberately not regenerated per attempt: if
  // the first request timed out but actually placed the order, pressing Place
  // again returns that order rather than making a second meal. Reset with the
  // form.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placedNumber, setPlacedNumber] = useState<string | null>(null);
  const [placedReference, setPlacedReference] = useState<string | null>(null);

  // Default the order type to whatever the branch actually offers.
  useEffect(() => {
    if (!acceptsPickup && acceptsDelivery) {
      setType('DELIVERY');
    }
  }, [acceptsPickup, acceptsDelivery]);

  // A delivery order can't be COD-collected if the branch doesn't take COD, and
  // COD is meaningless for pickup — keep the pay choice valid as type changes.
  useEffect(() => {
    if (pay === 'COD' && (type !== 'DELIVERY' || !acceptsCod)) {
      setPay('CASH_NOW');
    }
  }, [pay, type, acceptsCod]);

  const loadMenu = useCallback(async (): Promise<void> => {
    if (!branchId) return;
    setLoading(true);
    try {
      setMenu(await api.branchMenu(branchId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : t('couldNotLoad'));
    } finally {
      setLoading(false);
    }
  }, [api, branchId, t]);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  const items = useMemo<CounterOrderInput['items']>(
    () =>
      cart.map((l) => ({
        productId: l.product.id,
        productVariantId: l.variant?.id,
        quantity: l.quantity,
        addonIds: l.addons.map((a) => a.id),
        notes: l.notes,
      })),
    [cart],
  );

  // Fetch the authoritative total whenever the cart changes (debounced). The POS
  // shows it; it never computes a payable amount.
  useEffect(() => {
    if (!branchId || items.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .quoteCart(branchId, type, items)
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, branchId, type, items]);

  const addLine = (product: MenuProduct, variant: MenuVariant | null, addons: MenuAddon[]): void => {
    const key = lineKey(product, variant, addons);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key, product, variant, addons, quantity: 1 }];
    });
  };

  const onProductClick = (product: MenuProduct): void => {
    if (!product.isAvailable) {
      return;
    }
    const needsChoice = product.variants.length > 1 || product.modifierGroups.length > 0;
    if (needsChoice) {
      setConfiguring(product);
      return;
    }
    addLine(product, product.variants[0] ?? null, []);
  };

  const setQty = (key: string, delta: number): void => {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  };

  const canPlace =
    cart.length > 0 &&
    phone.trim().length > 0 &&
    (type !== 'DELIVERY' || (addr.line1.trim().length > 0 && addr.city.trim().length > 0));

  const place = async (): Promise<void> => {
    if (!branchId || !canPlace) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const input: CounterOrderInput = {
        branchId,
        type,
        customerPhone: phone.trim(),
        customerName: customerName.trim() || undefined,
        ...toPayment(pay),
        items,
        customerNotes: orderNotes.trim() || undefined,
        ...(type === 'DELIVERY'
          ? {
              deliveryAddress: {
                line1: addr.line1.trim(),
                city: addr.city.trim(),
                district: addr.district.trim() || undefined,
                notes: addr.notes.trim() || undefined,
              },
            }
          : {}),
      };
      const order = await api.createCounterOrder(input, idempotencyKey);
      setPlacedNumber(order.orderNumber);
      setPlacedReference(order.referenceId ?? null);
    } catch (e) {
      setPlaceError(e instanceof ApiError ? e.message : 'Could not place the order.');
    } finally {
      setPlacing(false);
    }
  };

  const reset = (): void => {
    // A new form is a new order, so it gets a new key.
    setIdempotencyKey(newIdempotencyKey());
    setCart([]);
    setPhone('');
    setCustomerName('');
    setOrderNotes('');
    setAddr({ line1: '', city: '', district: '', notes: '' });
    setPay('CASH_NOW');
    setPlacedNumber(null);
    setPlacedReference(null);
    setPlaceError(null);
  };

  if (!branchId) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          This account isn’t assigned to a branch, so counter orders can’t be taken here.
        </p>
      </div>
    );
  }

  if (placedNumber) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 40 }} aria-hidden>
          ✅
        </div>
        <h3 style={{ margin: '8px 0' }}>{t('orderPlaced')}</h3>
        <p className="mono" style={{ fontSize: 18, margin: '0 0 4px' }}>
          {placedNumber}
        </p>
        {/* The reference is what the customer quotes if they ring about this
            order — order numbers repeat across branches. */}
        {placedReference ? (
          <p className="muted mono" style={{ fontSize: 13, margin: '0 0 20px' }}>
            {t('reference')} {placedReference}
          </p>
        ) : (
          <div style={{ height: 16 }} />
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={reset}>
            {t('navNewOrder')}
          </button>
          <button className="btn secondary" onClick={onPlaced}>
            {t('navOrders')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <SectionTitle>{t('newOrderTitle')}</SectionTitle>
      {loadError ? <ErrorBanner message={loadError} onRetry={loadMenu} retryLabel={t('retry')} /> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* Menu */}
        <div>
          <SectionTitle>{t('menu')}</SectionTitle>
          {loading ? (
            <p className="muted">{t('loading')}</p>
          ) : menu && menu.categories.length > 0 ? (
            menu.categories.map((cat) => (
              <div key={cat.id} style={{ marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px' }}>{name(cat)}</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {cat.products.map((p) => (
                    // A sold-out item is shown but not orderable. The backend
                    // rejects an unavailable item at placement, which is far
                    // too late to discover with a customer at the counter.
                    <button
                      key={p.id}
                      className="card"
                      onClick={() => onProductClick(p)}
                      disabled={!p.isAvailable}
                      aria-disabled={!p.isAvailable}
                      style={{
                        textAlign: 'start',
                        cursor: p.isAvailable ? 'pointer' : 'not-allowed',
                        padding: 12,
                        border: '1px solid var(--border)',
                        opacity: p.isAvailable ? 1 : 0.45,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{name(p)}</div>
                      <div className="muted mono" style={{ fontSize: 13 }}>
                        {p.isAvailable ? formatSar(p.priceMinor) : t('soldOut')}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="muted">No sellable items on this branch’s menu.</p>
          )}
        </div>

        {/* Cart + customer + placement */}
        <div className="card" style={{ position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <SectionTitle>{t('cart')}</SectionTitle>
            {cart.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {t('cartEmpty')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cart.map((l) => (
                  <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 14 }}>
                      {name(l.product)}
                      {l.variant ? <span className="muted"> · {name(l.variant)}</span> : null}
                      {l.addons.length > 0 ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {l.addons.map((a) => name(a)).join(', ')}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button className="btn secondary" aria-label="Decrease" onClick={() => setQty(l.key, -1)} style={{ padding: '4px 10px' }}>
                        −
                      </button>
                      <span className="mono" style={{ minWidth: 20, textAlign: 'center' }}>
                        {l.quantity}
                      </span>
                      <button className="btn secondary" aria-label="Increase" onClick={() => setQty(l.key, 1)} style={{ padding: '4px 10px' }}>
                        +
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <strong>{t('total')}</strong>
                  <strong className="mono">{quote ? formatSar(quote.totalMinor) : '—'}</strong>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SectionTitle>{t('customer')}</SectionTitle>
            <Field label={t('phone')} htmlFor="cust-phone">
              <input
                id="cust-phone"
                className="input"
                inputMode="tel"
                dir="ltr"
                placeholder="+9665XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label={t('name')} htmlFor="cust-name">
              <input id="cust-name" className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionTitle>{t('orderType')}</SectionTitle>
            <div style={{ display: 'flex', gap: 8 }}>
              {acceptsPickup ? (
                <button className={`btn ${type === 'PICKUP' ? '' : 'secondary'}`} onClick={() => setType('PICKUP')}>
                  {t('pickup')}
                </button>
              ) : null}
              {acceptsDelivery ? (
                <button className={`btn ${type === 'DELIVERY' ? '' : 'secondary'}`} onClick={() => setType('DELIVERY')}>
                  {t('delivery')}
                </button>
              ) : null}
            </div>
          </div>

          {type === 'DELIVERY' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SectionTitle>{t('address')}</SectionTitle>
              <Field label={t('addressLine1')} htmlFor="addr-line1">
                <input id="addr-line1" className="input" value={addr.line1} onChange={(e) => setAddr((a) => ({ ...a, line1: e.target.value }))} />
              </Field>
              <Field label={t('addressCity')} htmlFor="addr-city">
                <input id="addr-city" className="input" value={addr.city} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))} />
              </Field>
              <Field label={t('addressDistrict')} htmlFor="addr-district">
                <input id="addr-district" className="input" value={addr.district} onChange={(e) => setAddr((a) => ({ ...a, district: e.target.value }))} />
              </Field>
              <Field label={t('addressNotes')} htmlFor="addr-notes">
                <input id="addr-notes" className="input" value={addr.notes} onChange={(e) => setAddr((a) => ({ ...a, notes: e.target.value }))} />
              </Field>
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionTitle>{t('payment')}</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <PayOption label={t('cashNow')} value="CASH_NOW" current={pay} onPick={setPay} dir={dir} />
              <PayOption label={t('cashLater')} value="CASH_LATER" current={pay} onPick={setPay} dir={dir} />
              {type === 'DELIVERY' && acceptsCod ? (
                <PayOption label={t('codPay')} value="COD" current={pay} onPick={setPay} dir={dir} />
              ) : null}
            </div>
          </div>

          <Field label={t('orderNotes')} htmlFor="order-notes">
            <input id="order-notes" className="input" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
          </Field>

          {placeError ? <ErrorBanner message={placeError} /> : null}

          <button className="btn block" disabled={!canPlace || placing} onClick={place}>
            {placing ? t('placing') : t('placeOrder')}
          </button>
          {cart.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
              {t('addItems')}
            </p>
          ) : null}
        </div>
      </div>

      {configuring ? (
        <ItemConfigurator
          product={configuring}
          onClose={() => setConfiguring(null)}
          onAdd={(variant, addons) => {
            addLine(configuring, variant, addons);
            setConfiguring(null);
          }}
        />
      ) : null}
    </>
  );
}

function PayOption({
  label,
  value,
  current,
  onPick,
  dir,
}: {
  label: string;
  value: PayChoice;
  current: PayChoice;
  onPick: (v: PayChoice) => void;
  dir: 'ltr' | 'rtl';
}): React.JSX.Element {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }}>
      <input type="radio" name="pay" checked={current === value} onChange={() => onPick(value)} />
      <span>{label}</span>
    </label>
  );
}

/** Picks a variant and add-ons for a product before it goes in the cart. */
function ItemConfigurator({
  product,
  onClose,
  onAdd,
}: {
  product: MenuProduct;
  onClose: () => void;
  onAdd: (variant: MenuVariant | null, addons: MenuAddon[]) => void;
}): React.JSX.Element {
  const { t, name } = useLang();
  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
  const [variant, setVariant] = useState<MenuVariant | null>(defaultVariant);
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());

  const allAddons = product.modifierGroups.flatMap((g) => g.addons);
  const toggleAddon = (id: string): void =>
    setAddonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (): void => onAdd(variant, allAddons.filter((a) => addonIds.has(a.id)));

  return (
    <Modal title={name(product)} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {product.variants.length > 0 ? (
          <div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              Option
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {product.variants.map((v) => (
                <label key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="radio" name="variant" checked={variant?.id === v.id} onChange={() => setVariant(v)} />
                  <span style={{ flex: 1 }}>{name(v)}</span>
                  <span className="muted mono">{formatSar(v.priceMinor)}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {product.modifierGroups.map((g) => (
          <div key={g.id}>
            <div className="muted" style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              {name(g)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.addons.map((a) => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={addonIds.has(a.id)} onChange={() => toggleAddon(a.id)} />
                  <span style={{ flex: 1 }}>{name(a)}</span>
                  <span className="muted mono">{formatSar(a.priceMinor)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <button className="btn block" onClick={add}>
          {t('cart')} +
        </button>
      </div>
    </Modal>
  );
}
