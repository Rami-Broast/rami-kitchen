import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useLang } from '../i18n/LangProvider';
import { DocketSectionId, DocketTemplate } from '../print/docket';
import { getPrinterConfig, printAndRecord } from '../print/printer';
import { sampleDocketOrder } from '../print/sample';
import { cacheDocketTemplate, docketLogo, docketTemplate } from '../print/template';
import { buildTicket, columnsFor } from '../print/tickets';

/**
 * **Receipt** — what this branch's printer is about to produce, on its own tab.
 *
 * It used to be reachable only by opening Print settings and scrolling past the
 * printer setup, which is the wrong place for it twice over: the question "what
 * does our receipt look like?" comes up during service, and the answer sat
 * behind a screen a branch is told to leave alone once the printer works.
 *
 * **The preview is the receipt, not a picture of one.** It calls the same
 * `buildTicket` the print path calls, on the same template the print path
 * reads, at the roll width the configured printer is set to, with the logo run
 * through the same rasteriser QZ will be handed. A preview drawn by a second,
 * prettier implementation agrees with the printer right up until the case
 * somebody needed to check.
 *
 * Three things it has to keep straight:
 *
 *  - **What a branch may change is two fields**, `readyTimeRules` and
 *    `thankYouLines` — the backend's `BRANCH_OVERRIDABLE_KEYS`. The layout, the
 *    brand lines and the footer are the owner's, and the footer is the line
 *    that keeps the document from reading as a tax invoice.
 *  - **The editor is gated per control, not per role.** `receipt-template:branch`
 *    is held by BRANCH_ADMIN and not by KITCHEN, so a counter account sees the
 *    preview and what is in effect, and no Save button that would answer 403.
 *  - **Saving must reach the printer, not only the screen.** A save writes to
 *    the server, then re-caches the resolved template the print path reads —
 *    otherwise a branch changes its thank-you, watches the preview update, and
 *    keeps printing the old one until the next sign-in.
 */

type Tab = 'docket' | 'kitchen';

const SECTION_KEYS: Record<DocketSectionId, string> = {
  logo: 'rsLogo',
  brand: 'rsBrand',
  orderType: 'rsOrderType',
  orderMeta: 'rsOrderMeta',
  customer: 'rsCustomer',
  readyTime: 'rsReadyTime',
  items: 'rsItems',
  totals: 'rsTotals',
  reference: 'rsReference',
  thankYou: 'rsThankYou',
};

const ALL_SECTIONS = Object.keys(SECTION_KEYS) as DocketSectionId[];

/** The two fields a branch may set, as the editor holds them while being typed. */
interface BranchDraft {
  thankYouLines: string[];
  readyTimeRules: DocketTemplate['readyTimeRules'];
}

function draftFrom(template: DocketTemplate): BranchDraft {
  return { thankYouLines: [...template.thankYouLines], readyTimeRules: { ...template.readyTimeRules } };
}

function sameDraft(a: BranchDraft, b: BranchDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ReceiptScreen(): React.JSX.Element {
  const { api, actor, branchId } = useAuth();
  const { t, lang } = useLang();

  const [template, setTemplate] = useState<DocketTemplate>(() => docketTemplate());
  const [hasOverride, setHasOverride] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('docket');

  // The roll the configured printer is actually loaded with. Previewing at a
  // width the branch does not use answers a question nobody asked — but the
  // other width stays one press away, because "the text ran off the edge" is
  // diagnosed by looking at both.
  const configuredWidth = getPrinterConfig().main.paperWidth;
  const [paperWidth, setPaperWidth] = useState<number>(configuredWidth);

  const [draft, setDraft] = useState<BranchDraft>(() => draftFrom(docketTemplate()));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [printResult, setPrintResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canEdit = actor?.permissions.includes('receipt-template:branch') ?? false;

  const load = useCallback(async (): Promise<void> => {
    if (!branchId) {
      return;
    }
    try {
      const { resolved, override } = await api.receiptTemplate(branchId);
      // Cached here, not only held in state: this is the copy the next print
      // reads, and a preview that is ahead of the printer is worse than none.
      const applied = cacheDocketTemplate(resolved);
      setTemplate(applied);
      setHasOverride(Object.keys(override ?? {}).length > 0);
      setDraft(draftFrom(applied));
      setLive(true);
    } catch {
      // The machine's own cached template still prints, so this is a state to
      // report rather than an error to raise: the branch is looking at what it
      // will print, just not at what the server may have changed since.
      setTemplate(docketTemplate());
      setLive(false);
    }
  }, [api, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const order = useMemo(() => sampleDocketOrder(), []);
  const columns = columnsFor(paperWidth);
  // Previewed against the draft, so an edit is visible before it is saved —
  // but the draft only ever carries the two fields a branch may set, so the
  // preview can never show a layout the server would refuse.
  const previewTemplate = useMemo<DocketTemplate>(
    () => (canEdit ? { ...template, ...draft } : template),
    [template, draft, canEdit],
  );
  const text = useMemo(
    () => buildTicket(tab, order, columns, previewTemplate),
    [tab, order, columns, previewTemplate],
  );

  const showLogo = tab === 'docket' && previewTemplate.printLogoImage && previewTemplate.sections.includes('logo');
  const [logoDots, setLogoDots] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!showLogo) {
      setLogoDots(null);
      return;
    }
    // The same call the print path makes, so what is on screen is the
    // thresholded one-ink image the printer will be handed — which is how a
    // branch finds out that fine detail does not survive here rather than on
    // the first receipt of the morning.
    void docketLogo(paperWidth).then((prepared) => {
      if (!cancelled) {
        setLogoDots(prepared);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showLogo, paperWidth, previewTemplate.logoWidthPercent, previewTemplate.logoImageUrl]);

  const dirty = canEdit && !sameDraft(draft, draftFrom(template));

  const save = async (): Promise<void> => {
    if (!branchId) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveBranchReceiptTemplate(branchId, {
        thankYouLines: draft.thankYouLines,
        readyTimeRules: draft.readyTimeRules,
      });
      // Re-read rather than trust the draft: the server resolves the owner's
      // template with this override on top, and that result — not what was
      // typed — is what prints.
      await load();
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const reset = async (): Promise<void> => {
    if (!branchId) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.clearBranchReceiptTemplate(branchId);
      await load();
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const printSample = async (): Promise<void> => {
    const config = getPrinterConfig();
    const profile = tab === 'kitchen' ? config.kitchen ?? config.main : config.main;
    const width = columnsFor(profile.paperWidth);
    const content = buildTicket(tab, order, width, docketTemplate());
    const logoBase64 = tab === 'docket' ? await docketLogo(profile.paperWidth) : null;
    const result = await printAndRecord(
      { kind: tab, orderId: 'preview', orderNumber: 'SAMPLE', content, logoBase64 },
      config,
    );
    setPrintResult({
      ok: result.ok,
      message: result.ok ? t('receiptPrinted') : result.error ?? t('receiptPrintFailed'),
    });
  };

  const off = ALL_SECTIONS.filter((id) => !previewTemplate.sections.includes(id));

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px' }}>{t('receiptTitle')}</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t('receiptHint')}
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['docket', 'kitchen'] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn ${tab === id ? 'brand' : 'secondary'}`}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {t(id === 'docket' ? 'receiptTabDocket' : 'receiptTabKitchen')}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {[80, 58].map((w) => (
            <button
              key={w}
              type="button"
              className={`btn ${paperWidth === w ? 'secondary' : 'ghost'}`}
              aria-pressed={paperWidth === w}
              style={{ padding: '6px 12px', fontSize: 13 }}
              onClick={() => setPaperWidth(w)}
            >
              {w}mm{w === configuredWidth ? ` · ${t('receiptRollYours')}` : ''}
            </button>
          ))}
        </div>

        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {t('receiptSample')} · {columns} {t('receiptColumns')}
        </p>

        {/*
          One sheet of paper, at the width the paper actually is.

          Two things have to be true at once and the obvious layout gets both
          wrong. **The column has to be the ticket's own width** — 42 characters
          on an 80mm roll, 32 on a 58mm one — because that is what the builder
          wrapped the text to, and **the logo has to be a share of that same
          width**, since the printer centres both on the same paper
          (`ESC a 1`, see `buildPrintData`).

          `fit-content` cannot do it: an image contributes its **intrinsic**
          width to a shrink-to-fit box, and the rasterised logo is 576 dots
          wide, so the paper ended up sized by the logo rather than by the
          ticket — about twice life size, with the logo visibly wider than the
          text it was supposed to sit over.

          `ch` is the fix, and it is exact rather than approximate: the paper is
          `columns` characters wide in whatever monospace font renders, so the
          full-width rule spans it precisely and the logo at 100% is flush with
          it. The font size is chosen so an 80mm roll comes out near its real
          72mm of printable width on screen — a receipt preview that is twice
          the size of a receipt is answering the wrong question.
        */}
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <div
            style={{
              width: `${columns}ch`,
              boxSizing: 'content-box',
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '12px 10px',
              direction: 'ltr',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 11,
            }}
          >
            {showLogo ? (
              <div style={{ marginBottom: 8 }}>
                {logoDots ? (
                  <img
                    src={`data:image/png;base64,${logoDots}`}
                    alt={t('receiptLogoAlt')}
                    style={{
                      display: 'block',
                      width: `${previewTemplate.logoWidthPercent ?? 100}%`,
                      height: 'auto',
                      margin: '0 auto',
                      imageRendering: 'pixelated',
                    }}
                  />
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                    {t('receiptLogoUnavailable')}
                  </p>
                )}
              </div>
            ) : null}

            <pre
              aria-label={t('receiptPreviewLabel')}
              style={{
                margin: 0,
                color: '#111',
                font: 'inherit',
                lineHeight: 1.35,
                whiteSpace: 'pre',
                textAlign: 'left',
              }}
            >
              {text}
            </pre>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn secondary" onClick={() => void printSample()}>
            {t('receiptPrintSample')}
          </button>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            {t('receiptRefresh')}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {live === false ? t('receiptFromCache') : live ? t('receiptFromServer') : ''}
          </span>
        </div>
        {printResult ? (
          <p
            role="status"
            style={{ margin: 0, fontSize: 13, color: printResult.ok ? 'var(--success)' : 'var(--danger)' }}
          >
            {printResult.message}
          </p>
        ) : null}
      </div>

      {tab === 'docket' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{t('receiptInEffect')}</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {previewTemplate.printLogoImage
              ? t('receiptLogoOn', { percent: previewTemplate.logoWidthPercent ?? 100 })
              : t('receiptLogoOff')}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {off.length === 0
              ? t('receiptAllSections')
              : `${t('receiptSectionsOff')} ${off.map((id) => t(SECTION_KEYS[id])).join(lang === 'ar' ? '، ' : ', ')}`}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {t('receiptOwnerOnly')}
          </p>
        </div>
      ) : null}

      {tab === 'docket' && canEdit ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{t('receiptBranchSettings')}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {t('receiptBranchHint')}
            </p>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t('receiptThankYou')}</span>
            <textarea
              className="input"
              rows={3}
              // `auto`, not the UI's direction: these lines are printed as
              // typed, and an English thank-you sitting in an Arabic-direction
              // box shows its punctuation on the wrong end — a line that reads
              // one way here and another on the paper.
              dir="auto"
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
              value={draft.thankYouLines.join('\n')}
              onChange={(e) => {
                setSaved(false);
                setDraft({ ...draft, thankYouLines: e.target.value.split('\n') });
              }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {t('receiptOneLineEach')}
            </span>
          </label>

          <ReadyTimeEditor
            rules={draft.readyTimeRules}
            onChange={(readyTimeRules) => {
              setSaved(false);
              setDraft({ ...draft, readyTimeRules });
            }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn" disabled={!dirty || saving} onClick={() => void save()}>
              {t('receiptSave')}
            </button>
            {hasOverride ? (
              <button type="button" className="btn ghost" disabled={saving} onClick={() => void reset()}>
                {t('receiptReset')}
              </button>
            ) : null}
            {saveError ? (
              <span role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>
                {t('receiptNotSaved')} — {saveError}
              </span>
            ) : dirty ? (
              <span className="muted" style={{ fontSize: 13 }}>
                {t('receiptUnsaved')}
              </span>
            ) : saved ? (
              <span style={{ fontSize: 13, color: 'var(--success)' }}>{t('receiptSaved')}</span>
            ) : null}
          </div>
        </div>
      ) : tab === 'docket' ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t('receiptReadOnly')}
        </p>
      ) : null}

      {hasOverride && tab === 'docket' ? (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {t('receiptHasOverride')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The ready-time rules, as the four numbers they are.
 *
 * Held as numbers rather than strings because every one of them has a real
 * zero — "no extra minutes for a delivery" is a genuine setting — so there is
 * no blank-versus-zero distinction to protect here, unlike the delivery-pricing
 * fields in the admin panel.
 */
function ReadyTimeEditor({
  rules,
  onChange,
}: {
  rules: DocketTemplate['readyTimeRules'];
  onChange: (next: DocketTemplate['readyTimeRules']) => void;
}): React.JSX.Element {
  const { t } = useLang();

  const num = (raw: string, fallback: number): number => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{t('receiptReadyTime')}</span>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {t('receiptReadyTimeHint')}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t('receiptSmallOrder')}
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="input"
              style={{ width: 72 }}
              type="number"
              min={0}
              aria-label={`${t('receiptSmallOrder')} ${t('receiptFrom')}`}
              value={rules.smallOrderMinutes[0]}
              onChange={(e) =>
                onChange({
                  ...rules,
                  smallOrderMinutes: [num(e.target.value, rules.smallOrderMinutes[0]), rules.smallOrderMinutes[1]],
                })
              }
            />
            <span className="muted">–</span>
            <input
              className="input"
              style={{ width: 72 }}
              type="number"
              min={0}
              aria-label={`${t('receiptSmallOrder')} ${t('receiptTo')}`}
              value={rules.smallOrderMinutes[1]}
              onChange={(e) =>
                onChange({
                  ...rules,
                  smallOrderMinutes: [rules.smallOrderMinutes[0], num(e.target.value, rules.smallOrderMinutes[1])],
                })
              }
            />
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t('receiptLargeOrder')}
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="input"
              style={{ width: 72 }}
              type="number"
              min={0}
              aria-label={`${t('receiptLargeOrder')} ${t('receiptFrom')}`}
              value={rules.largeOrderMinutes[0]}
              onChange={(e) =>
                onChange({
                  ...rules,
                  largeOrderMinutes: [num(e.target.value, rules.largeOrderMinutes[0]), rules.largeOrderMinutes[1]],
                })
              }
            />
            <span className="muted">–</span>
            <input
              className="input"
              style={{ width: 72 }}
              type="number"
              min={0}
              aria-label={`${t('receiptLargeOrder')} ${t('receiptTo')}`}
              value={rules.largeOrderMinutes[1]}
              onChange={(e) =>
                onChange({
                  ...rules,
                  largeOrderMinutes: [rules.largeOrderMinutes[0], num(e.target.value, rules.largeOrderMinutes[1])],
                })
              }
            />
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t('receiptDeliveryExtra')}
          <input
            className="input"
            style={{ width: 96 }}
            type="number"
            min={0}
            value={rules.deliveryExtraMinutes}
            onChange={(e) =>
              onChange({ ...rules, deliveryExtraMinutes: num(e.target.value, rules.deliveryExtraMinutes) })
            }
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t('receiptLargeThreshold')}
          <input
            className="input"
            style={{ width: 110 }}
            type="number"
            min={0}
            step={1}
            value={Math.round(rules.largeOrderThresholdMinor / 100)}
            onChange={(e) =>
              onChange({
                ...rules,
                largeOrderThresholdMinor:
                  num(e.target.value, Math.round(rules.largeOrderThresholdMinor / 100)) * 100,
              })
            }
          />
        </label>
      </div>
    </div>
  );
}
