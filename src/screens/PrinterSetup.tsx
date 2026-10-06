import React, { useCallback, useEffect, useState } from 'react';

import { Api } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { useLang } from '../i18n/LangProvider';
import {
  buildCertificateInstaller,
  detectPlatform,
  installerFilename,
} from '../print/certificateInstaller';
import { DiscoveredPrinter, DiscoveryResult, discoverPrinters } from '../print/discovery';
import {
  PrinterConfig,
  PrinterProfile,
  checkQzTray,
  printAndRecord,
  savePrinterConfig,
} from '../print/printer';
import { configureQzSigning } from '../print/qz-signing';
import { docketLogo } from '../print/template';
import { columnsFor } from '../print/tickets';

/**
 * Setting up the printer, as a guide the cashier can work down.
 *
 * The person doing this is opening a shop. They are not configuring a
 * workstation, they may not have done it before, and there is nobody from the
 * platform standing next to them — so this is written as five numbered steps in
 * their own language, each of which either turns green by itself or says
 * exactly what to do next.
 *
 * Three things make it a guide rather than a form:
 *
 *  - **It includes the steps the app cannot do.** Plugging the printer in and
 *    starting QZ Tray are most of what actually goes wrong, and a screen that
 *    starts at "choose a printer" is a screen that assumes the hard part is
 *    already done.
 *  - **Every step it *can* check, it checks.** The cashier is never asked to
 *    confirm something the machine already knows; the chips are read off the
 *    real state, so "Done" means done rather than "I pressed the button".
 *  - **The one step that needs a person is asked as a symptom.** Nobody at a
 *    counter can answer "is this an 80mm or 58mm roll?", and the printer will
 *    not say. Everybody can answer "did the text run off the edge?".
 *
 * It is bilingual because a cashier in Riyadh reads the Arabic, and a guide in
 * a language you do not read is a guide you ring somebody about.
 */

type Stage = 'checking' | 'no-qz' | 'choose' | 'testing' | 'confirm' | 'done';
/**
 * `manual` is the state for a step nothing can verify — the cable, the power,
 * the paper. It carries no chip and never turns green: a tick on something
 * nobody checked is worse than no tick, because it tells a cashier to stop
 * looking at the step that is actually wrong.
 */
type StepState = 'done' | 'now' | 'next' | 'optional' | 'manual';

const QZ_DOWNLOAD = 'https://qz.io/download/';

/** One numbered step: its state chip, its words, and its controls when active. */
function Step({
  number,
  title,
  state,
  children,
}: {
  number: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useLang();
  // Tonal, like every other pill in this app: a coloured word on its own soft
  // ground. The first version used `var(--muted)` — a token that does not
  // exist — with white text, so the ground fell back to transparent and the
  // neutral chips were white on near-white. Three of the five steps carried a
  // label nobody could see.
  const tone =
    state === 'done'
      ? { bg: 'var(--success-soft)', fg: 'var(--success)', label: t('guideStepDone') }
      : state === 'now'
        ? { bg: 'var(--warning-soft)', fg: 'var(--warning)', label: t('guideStepNow') }
        : state === 'optional'
          ? { bg: 'var(--surface-3)', fg: 'var(--text-muted)', label: t('guideStepLater') }
          : state === 'manual'
            ? { bg: 'var(--surface-3)', fg: 'var(--text-muted)', label: t('guideStepCheck') }
            : { bg: 'var(--surface-3)', fg: 'var(--text-muted)', label: t('guideStepWaiting') };

  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 12,
        padding: '14px 0',
        borderTop: '1px solid var(--border)',
        // A step that is not this one's turn is legible but recedes, so the
        // eye lands on the thing to do now.
        opacity: state === 'next' ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          background:
            state === 'done'
              ? 'var(--success)'
              : state === 'now' || state === 'manual'
                ? 'var(--text)'
                : 'var(--surface-3)',
          // A step whose turn has not come is a grey number on grey, not a
          // black badge competing with the one to do now.
          color: state === 'next' || state === 'optional' ? 'var(--text-muted)' : '#fff',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        {state === 'done' ? '✓' : number}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 16 }}>{title}</strong>
          <span
            className="pill"
            style={{
              background: tone.bg,
              color: tone.fg,
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
            }}
          >
            {tone.label}
          </span>
        </div>
        <div style={{ marginTop: 6, display: 'grid', gap: 8 }}>{children}</div>
      </div>
    </li>
  );
}

function Body({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
      {children}
    </p>
  );
}

export function PrinterSetup({
  config,
  onConfig,
}: {
  config: PrinterConfig;
  onConfig: (next: PrinterConfig) => void;
}): React.JSX.Element {
  const { api } = useAuth();
  const { t } = useLang();

  const [stage, setStage] = useState<Stage>('checking');
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [showList, setShowList] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [signing, setSigning] = useState<boolean | null>(null);

  /** Saves as it goes: a setup half-done and not stored is a setup not done. */
  const commit = useCallback(
    (next: PrinterConfig) => {
      savePrinterConfig(next);
      onConfig(next);
      return next;
    },
    [onConfig],
  );

  const chooseAndTest = useCallback(
    async (printer: DiscoveredPrinter, current: PrinterConfig): Promise<void> => {
      setShowList(false);
      setStage('testing');
      setProblem(null);

      const main: PrinterProfile = {
        ...current.main,
        name: printer.name,
        model: printer.model,
        paperWidth: printer.paperWidth,
      };
      const next = commit({ ...current, adapter: 'qz', main });
      await sendTest(next, setProblem);
      setStage('confirm');
    },
    [commit],
  );

  const start = useCallback(async (): Promise<void> => {
    setStage('checking');
    setProblem(null);

    // Signing before the probe: `checkQzTray` is usually what opens the
    // session's socket, and a socket opened unsigned prompts for the rest of
    // it — which is the whole thing this is here to prevent.
    const configured = await configureQzSigning(api).catch(() => ({ signing: false }));
    setSigning(configured.signing);

    const qz = await checkQzTray();
    if (!qz.ok) {
      setStage('no-qz');
      return;
    }

    const found = await discoverPrinters();
    setDiscovery(found);

    // A printer already set up is not re-picked: a heuristic disagreeing with
    // a working branch is how a working branch stops working.
    if (config.main.name) {
      setStage('done');
      return;
    }
    if (found.suggestedMain) {
      await chooseAndTest(found.suggestedMain, config);
      return;
    }
    setShowList(true);
    setStage('choose');
  }, [api, chooseAndTest, config]);

  useEffect(() => {
    void start();
    // Deliberately once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reprints on the printer already chosen — the "print another test" path. */
  const testAgain = async (): Promise<void> => {
    setStage('testing');
    setProblem(null);
    await sendTest(config, setProblem);
    setStage('confirm');
  };

  const reprintNarrower = async (): Promise<void> => {
    // The symptom, not the number: 80mm and 58mm are the only two rolls, so
    // "it ran off the edge" has exactly one fix and it does not need a form.
    const paperWidth = config.main.paperWidth === 80 ? (58 as const) : (80 as const);
    const next = commit({ ...config, main: { ...config.main, paperWidth } });
    setStage('testing');
    await sendTest(next, setProblem);
    setStage('confirm');
  };

  const printers = discovery?.printers ?? [];
  const qzRunning = stage !== 'checking' && stage !== 'no-qz';
  const chosen = Boolean(config.main.name);

  // Step 1 is the one thing here nobody can check from software: no API says
  // whether a cable is in or a roll is loaded the right way up. So it never
  // turns green — it stays a thing to check, and the failure it causes surfaces
  // as "this computer reports no printers" rather than as a false tick.
  const step1: StepState = 'manual';
  const step2: StepState = qzRunning ? 'done' : 'now';
  const step3: StepState = chosen ? 'done' : qzRunning ? 'now' : 'next';
  const step4: StepState = stage === 'done' ? 'done' : chosen ? 'now' : 'next';

  /**
   * Why nothing will print, in one sentence, at the top.
   *
   * A cashier should not have to work out which green tick is missing — and
   * "it isn't printing" is the report that reaches an owner, so the screen has
   * to answer it before anyone has to ask. Ordered by what has to be true
   * first: no QZ, then no printers at all, then none chosen.
   */
  const blockedReason =
    stage === 'checking' || stage === 'testing'
      ? null
      : !qzRunning
        ? t('guideBlockedNoQz')
        : printers.length === 0 && !chosen
          ? t('guideBlockedNoPrintersFound')
          : !chosen
            ? t('guideBlockedNoPrinter')
            : null;

  return (
    <div className="card">
      <h3 style={{ margin: '0 0 4px' }}>{t('guideTitle')}</h3>
      <Body>{t('guideIntro')}</Body>

      {blockedReason ? (
        <div
          role="status"
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(200, 40, 40, 0.08)',
            border: '1px solid var(--danger)',
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>{t('guideWhyNoPrint')}</p>
          <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 600 }}>{blockedReason}</p>
        </div>
      ) : null}

      <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
        <Step number={1} title={t('guideStep1')} state={step1}>
          <Body>{t('guideStep1Body')}</Body>
          <Body>{t('guideStep1Note')}</Body>
        </Step>

        <Step number={2} title={t('guideStep2')} state={step2}>
          <Body>{t('guideStep2Body')}</Body>
          <p style={{ margin: 0, fontSize: 14, color: qzRunning ? 'var(--success)' : 'var(--danger)' }}>
            {qzRunning ? t('guideStep2Running') : t('guideStep2Missing')}
          </p>
          {stage === 'no-qz' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a className="btn" href={QZ_DOWNLOAD} target="_blank" rel="noreferrer">
                {t('guideGetQz')}
              </a>
              <button type="button" className="btn ghost" onClick={() => void start()}>
                {t('guideCheckAgain')}
              </button>
            </div>
          ) : null}
        </Step>

        <Step number={3} title={t('guideStep3')} state={step3}>
          <Body>{t('guideStep3Body')}</Body>
          {chosen ? (
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{t('guideStep3Chosen', { name: config.main.name })}</strong>
            </p>
          ) : null}

          {stage === 'choose' && printers.length === 0 ? <Body>{t('guideNoPrinters')}</Body> : null}

          {showList && printers.length > 0 ? (
            <>
              <Body>{t('guidePickPrinter')}</Body>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                {printers.map((printer) => (
                  <li key={printer.name}>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ width: '100%', textAlign: 'start' }}
                      onClick={() => void chooseAndTest(printer, config)}
                    >
                      <strong>{printer.name}</strong>
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {printer.paperWidth}mm · {printer.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : qzRunning ? (
            <button
              type="button"
              className="btn ghost"
              style={{ alignSelf: 'start' }}
              onClick={() => {
                setShowList(true);
                setStage('choose');
              }}
            >
              {chosen ? t('guideChooseAnother') : t('guidePickPrinter')}
            </button>
          ) : null}
        </Step>

        <Step number={4} title={t('guideStep4')} state={step4}>
          <Body>{t('guideStep4Body')}</Body>
          {problem ? (
            <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 14 }}>
              {/* The printer's own words, labelled, so a cashier can read the
                  reason down a phone rather than reporting "it didn't work". */}
              <strong>{t('guideTestFailed')}</strong> {problem}
            </p>
          ) : null}

          {stage === 'testing' ? <Body>{t('guideSending')}</Body> : null}

          {stage === 'confirm' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn brand" onClick={() => setStage('done')}>
                {t('guideLooksRight')}
              </button>
              <button type="button" className="btn ghost" onClick={() => void reprintNarrower()}>
                {t('guideRanOff')}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setShowList(true);
                  setStage('choose');
                }}
              >
                {t('guideNothing')}
              </button>
            </div>
          ) : null}

          {stage === 'done' && chosen ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void testAgain()}
              >
                {t('guidePrintTest')}
              </button>
            </div>
          ) : null}
        </Step>

        <Step number={5} title={t('guideStep5')} state="optional">
          {signing === true ? <CertificateStep api={api} /> : <Body>{t('guideStep5Body')}</Body>}
        </Step>
      </ol>

      {stage === 'done' ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 8,
            background: 'var(--surface-2, rgba(0,0,0,0.03))',
          }}
        >
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--success)' }}>{t('guideReady')}</strong> {t('guideReadyBody')}
          </p>
          <button
            type="button"
            className="btn ghost"
            style={{ marginTop: 8 }}
            onClick={() => void start()}
          >
            {t('guideStartOver')}
          </button>
        </div>
      ) : null}

      <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
        {t('guideNeedHelp')}
      </p>
    </div>
  );
}

/**
 * The one press that makes this computer trust the restaurant's certificate.
 *
 * The script is built with the certificate already inside it, so a branch
 * downloads **one file** and runs it: nothing to pair up, no path to type, no
 * order to get wrong. Skipping it costs a prompt once a session, not a print.
 */
function CertificateStep({ api }: { api: Api }): React.JSX.Element {
  const { t } = useLang();
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');
  const platform = detectPlatform(navigator.userAgent);

  const download = async (): Promise<void> => {
    setState('working');
    try {
      const certificate = await api.qzCertificate();
      const script = buildCertificateInstaller(certificate, platform);
      const url = URL.createObjectURL(new Blob([script], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = installerFilename(platform);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return (
    <>
      <Body>{t('guideStep5Body')}</Body>
      <Body>{platform === 'windows' ? t('guideStep5Windows') : t('guideStep5Unix')}</Body>
      <button
        type="button"
        className="btn ghost"
        style={{ alignSelf: 'start' }}
        onClick={() => void download()}
        disabled={state === 'working'}
      >
        {state === 'working' ? t('guidePreparing') : t('guideDownloadCertificate')}
      </button>
      {state === 'failed' ? (
        <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 14 }}>
          {t('guideCertificateUnavailable')}
        </p>
      ) : null}
    </>
  );
}

/**
 * The test print, which is the whole evidence the cashier judges.
 *
 * It carries the **logo** and a full-width rule on purpose: those are the two
 * things that go wrong invisibly — a logo sized for the wrong roll and a line
 * wider than the paper both look fine on screen.
 */
async function sendTest(
  config: PrinterConfig,
  onProblem: (message: string | null) => void,
): Promise<void> {
  const width = columnsFor(config.main.paperWidth);
  const content = [
    '='.repeat(width),
    'PRINTER TEST',
    config.main.name,
    `${config.main.paperWidth}mm · ${width} columns`,
    '-'.repeat(width),
    'The line above should reach both edges',
    'of the paper without wrapping.',
    new Date().toLocaleString(),
    '='.repeat(width),
  ].join('\n');

  const logoBase64 = await docketLogo(config.main.paperWidth);
  const result = await printAndRecord(
    { kind: 'docket', orderId: 'setup-test', orderNumber: 'TEST', content, logoBase64 },
    config,
  );

  onProblem(result.ok ? null : (result.error ?? 'The printer refused the job.'));
}
