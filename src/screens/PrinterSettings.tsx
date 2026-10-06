import React, { useCallback, useEffect, useState } from 'react';

import { DiscoveredPrinter, DiscoveryResult, discoverPrinters } from '../print/discovery';
import {
  DEFAULT_PRINTER_CONFIG,
  DEFAULT_PROFILE,
  KNOWN_PRINTER_MODELS,
  PrinterAdapterKind,
  PrinterConfig,
  PrinterProfile,
  clearPrintLog,
  getPrintLog,
  getPrinterConfig,
  printAndRecord,
  savePrinterConfig,
} from '../print/printer';
import { columnsFor } from '../print/tickets';
import { useLang } from '../i18n/LangProvider';
import { docketLogo } from '../print/template';
import { PrinterSetup } from './PrinterSetup';

/**
 * Print settings — the branch's printer setup, stored on this machine.
 *
 * Built around **Find printers** rather than a text box. The previous version
 * asked staff to type a printer's exact queue name, which is a thing they
 * cannot be expected to know and gets a branch stuck on opening day. Now the
 * machine is asked what it has, the likely receipt printer is preselected with
 * a stated reason, and the operator confirms.
 *
 * Two roles: the **main** printer (customer dockets, reprints) and an optional
 * **kitchen** printer. A branch with one device configures one device; kitchen
 * tickets fall back to main automatically.
 */
export function PrinterSettings({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useLang();
  const [config, setConfig] = useState<PrinterConfig>(() => getPrinterConfig());
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [log, setLog] = useState(() => getPrintLog());

  const update = (patch: Partial<PrinterConfig>): void => {
    setConfig((c) => ({ ...c, ...patch }));
    setSaved(false);
  };

  const updateProfile = (role: 'main' | 'kitchen', patch: Partial<PrinterProfile>): void => {
    setConfig((c) => {
      if (role === 'main') {
        return { ...c, main: { ...c.main, ...patch } };
      }
      return { ...c, kitchen: { ...(c.kitchen ?? DEFAULT_PROFILE), ...patch } };
    });
    setSaved(false);
  };

  const search = useCallback(async (): Promise<void> => {
    setSearching(true);
    setTestResult(null);
    try {
      const result = await discoverPrinters();
      setDiscovery(result);

      // Only auto-fill an empty setup. Overwriting a printer someone already
      // configured — because a heuristic disagreed — is how a working branch
      // stops working after an unrelated visit to this screen.
      setConfig((c) => {
        if (c.main.name || !result.suggestedMain) {
          return c;
        }
        setSaved(false);
        return {
          ...c,
          adapter: 'qz',
          main: applyDiscovered(c.main, result.suggestedMain),
          kitchen: result.suggestedKitchen
            ? applyDiscovered(c.kitchen ?? DEFAULT_PROFILE, result.suggestedKitchen)
            : c.kitchen,
        };
      });
    } finally {
      setSearching(false);
    }
  }, []);

  // Search once on open when nothing is set up yet, so the common case — a new
  // branch machine — needs no clicks before it shows something useful.
  useEffect(() => {
    if (!config.main.name) {
      void search();
    }
    // Deliberately once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (): void => {
    savePrinterConfig(config);
    setSaved(true);
  };

  const testPrint = async (kind: 'docket' | 'kitchen'): Promise<void> => {
    savePrinterConfig(config);
    setSaved(true);

    const profile = kind === 'kitchen' ? config.kitchen ?? config.main : config.main;
    const width = columnsFor(profile.paperWidth);
    const content = [
      '='.repeat(width),
      'رامي',
      'Rami Broast',
      `${kind === 'kitchen' ? 'KITCHEN' : 'MAIN'} PRINTER TEST`,
      profile.model,
      `${profile.paperWidth}mm · ${width} columns`,
      '-'.repeat(width),
      'If this is readable and cut cleanly,',
      'the printer is set up correctly.',
      new Date().toLocaleString(),
      '='.repeat(width),
    ].join('\n');

    const logoBase64 = kind === 'docket' ? await docketLogo(profile.paperWidth) : null;
    const result = await printAndRecord(
      { kind, orderId: 'test', orderNumber: 'TEST', content, logoBase64 },
      config,
    );

    setLog(getPrintLog());
    setTestResult({
      ok: result.ok,
      message: result.ok
        ? `Test sent to ${result.printerName ?? 'the printer'}${
            result.attempts && result.attempts > 1 ? ` after ${result.attempts} attempts` : ''
          }.`
        : result.error ?? 'Test failed.',
    });
  };

  const isQz = config.adapter === 'qz';

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{t('navPrint')}</h2>
        <button className="btn ghost" onClick={onClose}>
          {t('guideBackToOrders')}
        </button>
      </div>

      <PrinterSetup
        config={config}
        onConfig={(next) => {
          setConfig(next);
          setSaved(true);
        }}
      />

      {/* Everything below is the old screen, unchanged and folded away. It is
          what the setup above could not work out for itself — a second kitchen
          printer, a model that needs its ESC/POS framing turned off, the print
          log — and none of it is a question to put to somebody opening a shop. */}
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '6px 0' }}>
          {t('guideAdvanced')}
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="muted" style={{ margin: 0 }}>
          Stored on <b>this machine</b> — each branch sets up its own printers.
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Mode</span>
          <select
            className="input"
            value={config.adapter}
            onChange={(e) => update({ adapter: e.target.value as PrinterAdapterKind })}
          >
            <option value="mock">Preview only (no hardware)</option>
            <option value="qz">Thermal printer via QZ Tray</option>
          </select>
        </label>

        {isQz ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => void search()} disabled={searching}>
                {searching ? 'Searching…' : 'Find printers'}
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                Asks this machine what printers it has.
              </span>
            </div>

            {discovery?.error ? (
              <p style={{ margin: 0, color: 'var(--danger)' }}>{discovery.error}</p>
            ) : null}

            {discovery && discovery.printers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                  Found {discovery.printers.length}
                </span>
                {discovery.printers.map((p) => (
                  <PrinterRow
                    key={p.name}
                    printer={p}
                    selectedAsMain={config.main.name === p.name}
                    selectedAsKitchen={config.kitchen?.name === p.name}
                    onUseAsMain={() => {
                      updateProfile('main', applyDiscovered(config.main, p));
                    }}
                    onUseAsKitchen={() => {
                      updateProfile('kitchen', applyDiscovered(config.kitchen ?? DEFAULT_PROFILE, p));
                    }}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <ProfileCard
        title="Main printer"
        subtitle="Customer dockets and reprints. Kitchen tickets come here too unless a kitchen printer is set."
        profile={config.main}
        showName={isQz}
        onChange={(patch) => updateProfile('main', patch)}
      />

      {config.kitchen ? (
        <ProfileCard
          title="Kitchen printer"
          subtitle="Kitchen tickets print here instead of the main printer."
          profile={config.kitchen}
          showName={isQz}
          onChange={(patch) => updateProfile('kitchen', patch)}
          onRemove={() => update({ kitchen: null })}
        />
      ) : (
        <button
          className="btn ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => update({ kitchen: { ...DEFAULT_PROFILE } })}
        >
          + Add a separate kitchen printer
        </button>
      )}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Behaviour</h3>

        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={config.autoPrintKitchenOnAccept}
            onChange={(e) => update({ autoPrintKitchenOnAccept: e.target.checked })}
          />
          <span>Print the kitchen ticket automatically when an order is accepted</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
            Attempts per print
          </span>
          <input
            className="input"
            type="number"
            min={1}
            max={5}
            value={config.retryAttempts}
            onChange={(e) => update({ retryAttempts: clampAttempts(e.target.value) })}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            A printer that is briefly busy or waking up is retried before anyone is told.
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn secondary" onClick={() => void testPrint('docket')}>Test main printer</button>
        {config.kitchen ? (
          <button className="btn secondary" onClick={() => void testPrint('kitchen')}>Test kitchen printer</button>
        ) : null}
        <button
          className="btn ghost"
          onClick={() => {
            setConfig(DEFAULT_PRINTER_CONFIG);
            setSaved(false);
          }}
        >
          Reset
        </button>
        {saved ? <span className="muted" style={{ alignSelf: 'center' }}>Saved</span> : null}
      </div>

      {testResult ? (
        <p style={{ margin: 0, color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
          {testResult.message}
        </p>
      ) : null}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Recent prints</h3>
          {log.length > 0 ? (
            <button
              className="btn ghost"
              onClick={() => {
                clearPrintLog();
                setLog([]);
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        {log.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing printed yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {log.slice(0, 25).map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
                <span>
                  <b>{e.orderNumber}</b> · {e.kind}
                  {e.printerName ? <span className="muted"> · {e.printerName}</span> : null}
                </span>
                <span style={{ color: e.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {e.ok ? 'OK' : e.error ?? 'failed'}
                  <span className="muted mono"> · {new Date(e.at).toLocaleTimeString()}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
        </div>
      </details>
    </div>
  );
}

/** Copies what discovery inferred onto a profile, keeping anything already set. */
function applyDiscovered(current: PrinterProfile, found: DiscoveredPrinter): PrinterProfile {
  return { ...current, name: found.name, model: found.model, paperWidth: found.paperWidth };
}

function clampAttempts(raw: string): number {
  const parsed = Number.parseInt(raw, 10);

  return Number.isNaN(parsed) ? 1 : Math.min(5, Math.max(1, parsed));
}

function PrinterRow({
  printer,
  selectedAsMain,
  selectedAsKitchen,
  onUseAsMain,
  onUseAsKitchen,
}: {
  printer: DiscoveredPrinter;
  selectedAsMain: boolean;
  selectedAsKitchen: boolean;
  onUseAsMain: () => void;
  onUseAsKitchen: () => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--border, #e5e7eb)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 600 }}>
          {printer.name}
          {printer.isSystemDefault ? <span className="muted" style={{ fontWeight: 400 }}> · default</span> : null}
        </div>
        {/* The reason is shown so the suggestion is checkable, not magic. */}
        <div className="muted" style={{ fontSize: 12 }}>
          {printer.paperWidth}mm · {printer.reason}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={selectedAsMain ? 'btn' : 'btn secondary'} onClick={onUseAsMain}>
          {selectedAsMain ? 'Main ✓' : 'Use as main'}
        </button>
        <button className={selectedAsKitchen ? 'btn' : 'btn ghost'} onClick={onUseAsKitchen}>
          {selectedAsKitchen ? 'Kitchen ✓' : 'Use as kitchen'}
        </button>
      </div>
    </div>
  );
}

function ProfileCard({
  title,
  subtitle,
  profile,
  showName,
  onChange,
  onRemove,
}: {
  title: string;
  subtitle: string;
  profile: PrinterProfile;
  showName: boolean;
  onChange: (patch: Partial<PrinterProfile>) => void;
  onRemove?: () => void;
}): React.JSX.Element {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {onRemove ? (
          <button className="btn ghost" onClick={onRemove}>Remove</button>
        ) : null}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{subtitle}</p>

      {showName ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Printer name</span>
          <input
            className="input"
            value={profile.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Use “Find printers” above, or type the exact queue name"
          />
        </label>
      ) : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px' }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Model</span>
          <input
            className="input"
            list="printer-models"
            value={profile.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="e.g. Epson TM-T20III"
          />
          <datalist id="printer-models">
            {KNOWN_PRINTER_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 150 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Paper</span>
          <select
            className="input"
            value={profile.paperWidth}
            onChange={(e) => onChange({ paperWidth: Number(e.target.value) === 58 ? 58 : 80 })}
          >
            <option value={80}>80mm ({columnsFor(80)} cols)</option>
            <option value={58}>58mm ({columnsFor(58)} cols)</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 110 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Copies</span>
          <input
            className="input"
            type="number"
            min={1}
            max={5}
            value={profile.copies}
            onChange={(e) => onChange({ copies: clampAttempts(e.target.value) })}
          />
        </label>
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={profile.escPos}
          onChange={(e) => onChange({ escPos: e.target.checked })}
        />
        <span>
          Send ESC/POS cut command
          <span className="muted"> — turn off if the receipt prints stray characters</span>
        </span>
      </label>
    </div>
  );
}
