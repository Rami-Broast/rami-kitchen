import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/http';
import { PaymentsReport, ReportKpis, SalesReport, VatReport } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ErrorBanner, SectionTitle } from '../components/ui';
import { useLang } from '../i18n/LangProvider';
import { prepareLogo, logoSource } from '../print/logo';
import { getPrinterConfig, printAndRecord, profileFor } from '../print/printer';
import { docketTemplate } from '../print/template';
import { buildSalesReportTicket, columnsFor } from '../print/tickets';
import { formatAmount, formatSar } from '../util/money';
import { diagnoseForbidden } from '../util/permissionDiagnosis';
import {
  DayRange,
  RANGE_PRESETS,
  RangePresetId,
  daysInRange,
  isUsableRange,
  matchingPreset,
  presetRange,
  windowFor,
} from '../util/reportRange';

/**
 * The branch's own reports — the day's takings, and any window somebody picks.
 *
 * Why this is on the POS at all: the figures a branch needs at handover were
 * only ever reachable from the owner's admin panel, so "how did tonight go" was
 * a phone call, and the counter had every order on its own screen all day
 * without a sum of them anywhere. `reports:read` is the one financial
 * permission the KITCHEN role holds, granted for exactly this (backend
 * `prisma/seed/permissions.ts`); it stays **branch-scoped server-side**, so this
 * screen cannot surface another branch's revenue however the request is built.
 *
 * Three rules it keeps:
 *
 *  - **Nothing here is computed.** Every figure is a server sum, formatted.
 *    Same discipline as an order total: the POS displays money and never
 *    totals it, or the counter and the till can disagree.
 *  - **A window is local days, not a UTC day** (`util/reportRange.ts`). A UTC
 *    window would move three hours of this branch's own trade into the wrong
 *    report, every day, with nothing on screen saying so.
 *  - **Zero and "failed to load" must never look the same.** An empty window
 *    says it is empty; a refused request says what was refused and why.
 */
export function ReportsScreen(): React.JSX.Element {
  const { api, actor, branch, branchId } = useAuth();
  const { t, name, lang } = useLang();

  // `now` is fixed for the life of the screen so the presets and the highlight
  // agree with each other. Re-reading the clock per render would let a range
  // chosen at 23:59:58 be labelled against a different day two renders later.
  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<DayRange>(() => presetRange('today', now));

  const [sales, setSales] = useState<SalesReport | null>(null);
  const [vat, setVat] = useState<VatReport | null>(null);
  const [payments, setPayments] = useState<PaymentsReport | null>(null);
  const [kpis, setKpis] = useState<ReportKpis | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [printState, setPrintState] = useState<'idle' | 'ok' | 'failed'>('idle');

  const window = useMemo(() => windowFor(range), [range]);

  /**
   * Turns a refusal into something a branch can act on.
   *
   * The server will not name the permission it wanted (correctly — that maps
   * the model out for anyone probing), but this client already holds the
   * account's own list, so the comparison happens here. See
   * `util/permissionDiagnosis.ts`.
   */
  const describe = useCallback(
    (e: unknown): string => {
      if (!(e instanceof ApiError)) {
        return t('couldNotLoad');
      }
      if (e.statusCode !== 403) {
        // Falling back rather than returning a possibly-empty message: an
        // empty string is falsy, and the banner would not render at all — a
        // failed load that looks exactly like an empty window.
        return e.message || t('couldNotLoad');
      }
      const who = actor?.email ?? actor?.fullName ?? '';
      const roles = actor?.roles?.length ? actor.roles.join(', ') : t('noRole');
      const { missing, unexplained } = diagnoseForbidden('reports', actor?.permissions);

      if (unexplained) {
        return `${e.message} ${t('permsLookRight')} (${who} · ${roles})`;
      }
      return `${e.message} ${t('permsMissing')}: ${missing.join(', ')} — ${who} · ${roles}. ${t('permsFix')}`;
    },
    [actor, t],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!window) {
      return;
    }
    setLoading(true);
    setPrintState('idle');
    const query = { ...window, ...(branchId ? { branchId } : {}) };
    try {
      // One `Promise.all` rather than four awaits: these are four independent
      // reads of the same window, and run in series they would take four round
      // trips on a shop network while somebody waits between rushes.
      const [s, v, p, k] = await Promise.all([
        api.salesReport(query),
        api.vatReport(query),
        api.paymentsReport(query),
        api.reportKpis(query),
      ]);
      setSales(s);
      setVat(v);
      setPayments(p);
      setKpis(k);
      setError(null);
    } catch (e) {
      // The whole tab fails together on purpose. A partial sheet — takings with
      // no VAT, or a total with no payments — is one somebody would read as
      // complete, and there is no way to tell from the page which half is
      // missing.
      setError(describe(e));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [api, branchId, describe, window]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = useMemo(() => {
    const days = daysInRange(range);
    if (range.fromDay === range.toDay) {
      return range.fromDay;
    }
    return `${range.fromDay} → ${range.toDay}${days ? ` (${days})` : ''}`;
  }, [range]);

  /**
   * Prints the sheet on the counter's own roll.
   *
   * Deliberately **not** gated on the duplicate guard (`hasPrinted`): a shift
   * summary is a thing somebody legitimately prints twice — once for the till
   * and once for whoever is taking over — unlike an order docket. It is still
   * written to the print log, which is the record of what this terminal has
   * produced.
   *
   * `orderId` carries the window rather than an order id, because that is what
   * identifies this document in the log; a report has no order.
   */
  const print = useCallback(async (): Promise<void> => {
    if (!sales) {
      return;
    }
    const config = getPrinterConfig();
    const profile = profileFor(config, 'report');
    const content = buildSalesReportTicket(
      {
        branchName: branch ? name(branch) : null,
        periodLabel,
        sales,
        vat,
        payments,
        kpis,
        printedAt: new Date().toISOString(),
      },
      columnsFor(profile.paperWidth),
    );
    const logoBase64 = await prepareLogo(logoSource(docketTemplate().logoImageUrl), profile.paperWidth).catch(() => null);
    const result = await printAndRecord(
      {
        kind: 'report',
        orderId: `report:${range.fromDay}:${range.toDay}`,
        orderNumber: periodLabel,
        content,
        logoBase64,
      },
      config,
    );
    setPrintState(result.ok ? 'ok' : 'failed');
  }, [branch, kpis, name, payments, periodLabel, range, sales, vat]);

  const activePreset = matchingPreset(range, now);
  const usable = isUsableRange(range);
  const days = daysInRange(range);
  // "No orders at all" is a real, common answer — a branch opening, a quiet
  // morning — and it has to read as an answer rather than as a failure.
  const empty = loaded && !error && sales !== null && sales.statusBreakdown.length === 0;

  return (
    <div>
      <SectionTitle>{t('reportsTitle')}</SectionTitle>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('reportsHint')}
      </p>

      {/* --- The window ----------------------------------------------------- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`btn ${activePreset === preset ? 'brand' : 'secondary'}`}
              aria-pressed={activePreset === preset}
              onClick={() => setRange(presetRange(preset, new Date()))}
            >
              {t(PRESET_LABELS[preset])}
            </button>
          ))}
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="muted" style={{ fontSize: 13, fontWeight: 700, padding: 0 }}>
            {t('reportsCustom')}
          </legend>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                {t('reportsFrom')}
              </span>
              <input
                type="date"
                className="input"
                value={range.fromDay}
                max={range.toDay || undefined}
                onChange={(e) => setRange((r) => ({ ...r, fromDay: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                {t('reportsTo')}
              </span>
              <input
                type="date"
                className="input"
                value={range.toDay}
                min={range.fromDay || undefined}
                onChange={(e) => setRange((r) => ({ ...r, toDay: e.target.value }))}
              />
            </label>
            <button className="btn secondary" type="button" onClick={() => void load()} disabled={!usable || loading}>
              {loading ? t('loading') : t('reportsRefresh')}
            </button>
          </div>
        </fieldset>

        <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 13 }}>
          {days === 1 ? t('reportsOneDay') : days ? t('reportsDays', { n: days }) : ''}
          {days ? ' · ' : ''}
          {t('reportsLocalDays')}
        </p>

        {/* A half-typed or backwards range is announced rather than silently
            showing the last window's figures under the new dates — which is a
            number read against a period it does not cover. */}
        {!usable ? (
          <p role="alert" style={{ color: 'var(--danger)', marginBottom: 0, marginTop: 8 }}>
            {t('reportsBadRange')}
          </p>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} retryLabel={t('reportsRefresh')} /> : null}

      {/* --- Print --------------------------------------------------------- */}
      {sales && !error ? (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <button className="btn secondary" type="button" onClick={() => void print()}>
            {t('reportsPrint')}
          </button>
          {printState === 'ok' ? <span className="muted">{t('reportsPrinted')}</span> : null}
          {printState === 'failed' ? (
            <span role="alert" style={{ color: 'var(--danger)' }}>
              {t('reportsPrintFailed')}
            </span>
          ) : null}
        </div>
      ) : null}

      {empty ? (
        <div className="card" role="note" style={{ marginBottom: 12 }}>
          {t('reportsEmpty')}
        </div>
      ) : null}

      {!loaded && loading ? (
        <p className="muted">{t('loading')}</p>
      ) : null}

      {sales && !error ? (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{t('reportsRealised')}</h3>
            <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
              {t('reportsRealisedHint')}
            </p>
            <Figures>
              <Figure label={t('reportsOrders')} value={String(sales.realised.orders)} />
              <Figure label={t('reportsSubtotal')} value={formatSar(sales.realised.subtotalMinor)} />
              {/* The unit is on every figure in this row, zero included. A
                  bare "0.00" beside "SAR 0.00" reads as a different kind of
                  number — and this is a row somebody scans for the odd one
                  out. The minus stays because a discount moves the total
                  down, and a positive figure under "subtotal" reads as
                  something added. */}
              <Figure
                label={t('reportsDiscounts')}
                value={
                  sales.realised.discountMinor > 0
                    ? `-${formatSar(sales.realised.discountMinor)}`
                    : formatSar(0)
                }
              />
              <Figure label={t('reportsDeliveryFees')} value={formatSar(sales.realised.deliveryFeeMinor)} />
              <Figure label={t('reportsCharges')} value={formatSar(sales.realised.chargesMinor)} />
              <Figure label={t('reportsTotal')} value={formatSar(sales.realised.totalMinor)} strong />
            </Figures>
            {/* VAT is stated apart from the figures above, not level with them:
                prices are VAT-inclusive, so a VAT row flush with subtotal and
                delivery reads as "+ VAT" to anyone checking the arithmetic —
                which overstates the day by the whole of the tax. */}
            <p style={{ marginBottom: 0, marginTop: 12 }}>
              <strong>{t('reportsVatIncluded')}:</strong> {formatSar(sales.realised.vatMinor)}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {t('reportsVatInclusiveNote')}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{t('reportsByStatus')}</h3>
            <Table
              headers={[t('reportsStatus'), t('reportsOrders'), t('reportsAmount')]}
              rows={sales.statusBreakdown.map((row) => [
                row.status,
                String(row.orders),
                formatAmount(row.totalMinor),
              ])}
              emptyLabel={t('reportsNoRows')}
              lang={lang}
            />
          </div>

          {sales.charges.length > 0 ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>{t('reportsChargeBreakdown')}</h3>
              <Table
                headers={[t('reportsCharges'), t('reportsCount'), t('reportsAmount')]}
                rows={sales.charges.map((row) => [
                  row.name,
                  String(row.count),
                  formatAmount(row.totalMinor),
                ])}
                emptyLabel={t('reportsNoRows')}
                lang={lang}
              />
            </div>
          ) : null}

          {payments ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>{t('reportsPayments')}</h3>
              <Figures>
                <Figure label={t('reportsCaptured')} value={formatSar(payments.totals.capturedMinor)} />
                <Figure
                  label={t('reportsRefunded')}
                  value={
                    payments.totals.refundedMinor > 0
                      ? `-${formatSar(payments.totals.refundedMinor)}`
                      : formatSar(0)
                  }
                />
                <Figure label={t('reportsNetTaken')} value={formatSar(payments.totals.netCapturedMinor)} strong />
              </Figures>
              <h4 style={{ marginBottom: 4 }}>{t('reportsByMethod')}</h4>
              <Table
                headers={[t('reportsMethod'), t('reportsOrders'), t('reportsCaptured'), t('reportsRefunded')]}
                rows={payments.byMethod.map((row) => [
                  row.method ?? '—',
                  String(row.payments),
                  formatAmount(row.capturedMinor),
                  formatAmount(row.refundedMinor),
                ])}
                emptyLabel={t('reportsNoRows')}
                lang={lang}
              />
              <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
                {t('reportsCodPending')}
              </p>
            </div>
          ) : null}

          {vat ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>{t('reportsVat')}</h3>
              <Table
                headers={[t('reportsVatRate'), t('reportsOrders'), t('reportsTaxableBase'), t('reportsVat')]}
                rows={vat.byRate.map((row) => [
                  row.vatRate,
                  String(row.orders),
                  formatAmount(row.taxableBaseMinor),
                  formatAmount(row.vatMinor),
                ])}
                emptyLabel={t('reportsNoRows')}
                lang={lang}
              />
              <p style={{ marginBottom: 4 }}>
                <strong>{t('reportsTotalVat')}:</strong> {formatSar(vat.totalVatMinor)}
              </p>
              {/* Both caveats are shown here and printed on the sheet. A figure
                  that leaves the screen has to take its qualifications with it,
                  and this one has a total and a VAT line, so it looks like a tax
                  invoice. */}
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t('reportsVatGross')}
              </p>
              <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
                {t('reportsNotTaxInvoice')}
              </p>
            </div>
          ) : null}

          {kpis ? (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('reportsTimings')}</h3>
              <Figures>
                <Figure
                  label={t('reportsPrepTime')}
                  value={formatDuration(kpis.avgPrepTimeSeconds)}
                  note={
                    kpis.avgPrepTimeSeconds === null
                      ? t('reportsNoSamples')
                      : t('reportsSamples', { n: kpis.prepTimeSamples })
                  }
                />
                <Figure
                  label={t('reportsDeliveryTime')}
                  value={formatDuration(kpis.avgDeliveryTimeSeconds)}
                  note={
                    kpis.avgDeliveryTimeSeconds === null
                      ? t('reportsNoSamples')
                      : t('reportsSamples', { n: kpis.deliveryTimeSamples })
                  }
                />
              </Figures>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const PRESET_LABELS: Record<RangePresetId, string> = {
  today: 'reportsToday',
  yesterday: 'reportsYesterday',
  last7: 'reportsLast7',
  thisMonth: 'reportsThisMonth',
};

/**
 * A timing, or an em dash.
 *
 * **Null is not zero.** The server sends null when nothing in the window
 * finished, and "0 min" would read as a kitchen that plates instantly rather
 * than as a window with nothing in it.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '—';
  }
  const whole = Math.max(0, Math.round(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function Figures({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {label}
      </p>
      <p className="mono" style={{ margin: 0, fontSize: strong ? 22 : 17, fontWeight: strong ? 700 : 500 }}>
        {value}
      </p>
      {note ? (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A plain table with its own empty state.
 *
 * The numeric columns are aligned to the **end** of the line rather than to the
 * right, so a column of figures still sits under its own heading when the app is
 * flipped to Arabic. Hard-coding `right` puts the amounts on the far side of the
 * screen from their labels in RTL.
 */
function Table({
  headers,
  rows,
  emptyLabel,
  lang,
}: {
  headers: string[];
  rows: string[][];
  emptyLabel: string;
  lang: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }} lang={lang}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} style={{ ...cell, fontWeight: 600, textAlign: i === 0 ? 'start' : 'end' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((value, j) => (
                <td
                  key={j}
                  className={j === 0 ? undefined : 'mono'}
                  style={{ ...cell, textAlign: j === 0 ? 'start' : 'end' }}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid var(--border)',
};
