/**
 * The Branch POS print engine.
 *
 * Printers are per-branch by model and hang off the POS machine, so everything
 * about them lives here — the backend never talks to a printer.
 *
 * What this owns:
 *  - **Two roles, one or two devices.** A branch prints customer dockets and
 *    kitchen tickets. Many branches have one printer for both; some have a
 *    second in the kitchen. `kitchen` falls back to `main` when unset, so a
 *    one-printer branch configures one thing.
 *  - **Retries.** A thermal printer that is out of paper, asleep, or briefly
 *    unreachable is the normal case mid-service, not an exception. A failed
 *    print retries with a short backoff before it gives up and tells someone.
 *  - **A print log and a duplicate guard**, so the same ticket is not silently
 *    printed twice, and so "did that order print?" is answerable.
 *  - **ESC/POS framing** — initialise and cut — behind a per-profile switch.
 *
 * The mock adapter is the default and needs no hardware: it reports success so
 * the on-screen preview, the log and the whole flow are exercisable. The QZ
 * adapter is the real path.
 */
import { PaperWidth } from './discovery';
import { QzApi, resolveQz } from './qz-client';
import { TicketKind } from './tickets';

export type PrinterAdapterKind = 'mock' | 'qz';

/** Which of the two documents a job is; decides which device it goes to. */
export type PrinterRole = 'main' | 'kitchen';

/** One configured device. */
export interface PrinterProfile {
  /** Exact queue name as the machine reports it. Sent to QZ verbatim. */
  name: string;
  /** Human label, for the settings screen and the print log. */
  model: string;
  paperWidth: PaperWidth;
  /** Copies per print. Some kitchens want two of every ticket. */
  copies: number;
  /**
   * Send the standard ESC/POS initialise and full-cut commands around the
   * ticket. On by default because nearly every thermal printer speaks ESC/POS
   * and an uncut receipt has to be torn by hand; switchable off for a device
   * that renders the raw bytes as text instead of obeying them.
   */
  escPos: boolean;
}

export interface PrinterConfig {
  adapter: PrinterAdapterKind;
  main: PrinterProfile;
  /** `null` means "kitchen tickets go to the main printer". */
  kitchen: PrinterProfile | null;
  /** Print the kitchen ticket automatically when an order is accepted. */
  autoPrintKitchenOnAccept: boolean;
  /** Total attempts per job, including the first. 1 disables retrying. */
  retryAttempts: number;
}

export interface PrintJob {
  kind: TicketKind;
  orderId: string;
  orderNumber: string;
  content: string;
  /**
   * The logo, already sized for this roll and base64-encoded (see
   * `print/logo.ts`). Absent means print the text and nothing else — which is
   * what happens whenever the artwork cannot be prepared, because a receipt
   * without a header still tells the customer what they bought.
   */
  logoBase64?: string | null;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  /** How many attempts it took (or were spent failing). */
  attempts?: number;
  /** Which device it went to, for the log. */
  printerName?: string;
}

export interface Printer {
  readonly adapter: PrinterAdapterKind;
  print(job: PrintJob): Promise<PrintResult>;
}

/** Common thermal models the picker offers; free text is allowed too. */
export const KNOWN_PRINTER_MODELS = [
  'Epson TM-T20III',
  'Epson TM-T88VI',
  'Star TSP143III',
  'Xprinter XP-58',
  'Xprinter XP-80',
  'Rongta RP80',
  'Bixolon SRP-350III',
  'Generic ESC/POS',
] as const;

export const DEFAULT_PROFILE: PrinterProfile = {
  name: '',
  model: 'Generic ESC/POS',
  paperWidth: 80,
  copies: 1,
  escPos: true,
};

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  adapter: 'mock',
  main: { ...DEFAULT_PROFILE },
  kitchen: null,
  autoPrintKitchenOnAccept: false,
  retryAttempts: 3,
};

const CONFIG_KEY = 'rami.pos.printer';

/**
 * The shape this app stored before printer roles existed: one flat adapter +
 * model + connection. Machines already in use hold it, so it is migrated rather
 * than discarded — a branch that had a working printer must not silently lose
 * it on upgrade and start printing nowhere.
 */
interface LegacyPrinterConfig {
  adapter?: PrinterAdapterKind;
  model?: string;
  connection?: string;
}

function isLegacy(raw: unknown): raw is LegacyPrinterConfig {
  return typeof raw === 'object' && raw !== null && !('main' in raw);
}

export function migrateConfig(raw: unknown): PrinterConfig {
  if (isLegacy(raw)) {
    return {
      ...DEFAULT_PRINTER_CONFIG,
      adapter: raw.adapter ?? DEFAULT_PRINTER_CONFIG.adapter,
      main: {
        ...DEFAULT_PROFILE,
        name: raw.connection ?? '',
        model: raw.model ?? DEFAULT_PROFILE.model,
      },
    };
  }

  const partial = (raw ?? {}) as Partial<PrinterConfig>;

  return {
    ...DEFAULT_PRINTER_CONFIG,
    ...partial,
    main: { ...DEFAULT_PROFILE, ...(partial.main ?? {}) },
    kitchen: partial.kitchen ? { ...DEFAULT_PROFILE, ...partial.kitchen } : null,
  };
}

export function getPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? migrateConfig(JSON.parse(raw)) : DEFAULT_PRINTER_CONFIG;
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

export function savePrinterConfig(config: PrinterConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // A machine with no storage still prints from the in-memory config.
  }
}

/** The device a job of this kind should go to. Pure. */
export function profileFor(config: PrinterConfig, kind: TicketKind): PrinterProfile {
  return kind === 'kitchen' ? config.kitchen ?? config.main : config.main;
}

/** The role a ticket kind maps to. Pure — used for labelling in the UI. */
export function roleFor(kind: TicketKind): PrinterRole {
  return kind === 'kitchen' ? 'kitchen' : 'main';
}

// --- ESC/POS framing --------------------------------------------------------

/**
 * The two standard ESC/POS commands worth sending, and nothing else.
 *
 * `ESC @` resets the printer to a known state, so a previous job's font or
 * alignment cannot bleed into this one. `GS V 0` is a full cut. Both are part
 * of the published ESC/POS command set that essentially every thermal receipt
 * printer implements; nothing model-specific is guessed here. A device that
 * does not obey them prints them as stray characters, which is why `escPos` is
 * switchable per profile.
 */
const ESC_INIT = '\x1B\x40';
const ESC_FULL_CUT = '\x1D\x56\x00';
/** `ESC a n` — 1 centres, 0 returns to the left. Same published command set. */
const ESC_ALIGN_CENTRE = '\x1B\x61\x01';
const ESC_ALIGN_LEFT = '\x1B\x61\x00';

/**
 * One QZ print job: the logo, then the ticket, then the cut.
 *
 * QZ takes an array, and an **image has to be its own entry** — it is a
 * different `format`, and QZ is what turns it into this printer's raster
 * commands. That is deliberate: the raster encoding is the model-specific part,
 * and guessing it is what the print engine has always refused to do.
 *
 * The order matters. `ESC @` first, so a previous job's alignment cannot make
 * the logo land against the left margin; the centring around the image, so a
 * logo narrower than the roll sits where a header belongs; and the cut last,
 * after the text, or the receipt is cut before it is printed.
 *
 * Pure, and returns QZ's own data shape so a test can assert what was sent —
 * printing is the one thing in this app that cannot be checked by looking.
 */
export type QzPrintData =
  | string
  | {
      type: 'raw';
      format: 'image';
      flavor: 'base64';
      data: string;
      options: { language: 'ESCPOS'; dotDensity: 'double' };
    };

export function buildPrintData(
  content: string,
  profile: PrinterProfile,
  logoBase64?: string | null,
): QzPrintData[] {
  if (!logoBase64) {
    return [frameForPrinter(content, profile)];
  }

  const body = `${content}\n\n\n`;

  return [
    ...(profile.escPos ? [ESC_INIT] : []),
    profile.escPos ? ESC_ALIGN_CENTRE : '',
    {
      type: 'raw' as const,
      format: 'image' as const,
      flavor: 'base64' as const,
      data: logoBase64,
      options: { language: 'ESCPOS' as const, dotDensity: 'double' as const },
    },
    profile.escPos ? `${ESC_ALIGN_LEFT}\n` : '\n',
    body,
    ...(profile.escPos ? [ESC_FULL_CUT] : []),
  ].filter((entry) => entry !== '');
}

/** Wraps ticket text in the framing this profile asks for. Pure. */
export function frameForPrinter(content: string, profile: PrinterProfile): string {
  // Feed a few lines before cutting: the cutter sits above the print head, so
  // without this the last lines are still inside the printer when it cuts.
  const body = `${content}\n\n\n`;

  return profile.escPos ? `${ESC_INIT}${body}${ESC_FULL_CUT}` : body;
}

// --- Adapters ---------------------------------------------------------------

/** The mock adapter: no hardware. Succeeds so the preview + log flow works. */
class MockPrinter implements Printer {
  readonly adapter = 'mock' as const;

  constructor(private readonly config: PrinterConfig) {}

  async print(job: PrintJob): Promise<PrintResult> {
    const profile = profileFor(this.config, job.kind);

    return { ok: true, attempts: 1, printerName: profile.name || 'preview' };
  }
}

/**
 * The QZ Tray adapter — the real path to a branch's thermal printer.
 *
 * Deliberately conservative: it never reports success it did not get, and it
 * separates the failures an operator can act on — no printer chosen, QZ not
 * running, the device rejecting the job — because "printing failed" tells a
 * counter nothing at 8pm on a Friday.
 *
 * Still unproven against hardware: no branch printer has been available to test
 * against, and per-model quirks (raster mode, cut behaviour) are a per-branch
 * commissioning step. Treat a first print at a new branch as a task, not a given.
 */
class QzTrayPrinter implements Printer {
  readonly adapter = 'qz' as const;

  constructor(
    private readonly config: PrinterConfig,
    private readonly qz: QzApi = resolveQz(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    /**
     * Installs request signing, which QZ reads **when the socket opens** — so
     * it has to happen before `connect`, not after. Awaited and never allowed
     * to throw: a branch with no certificate prints with QZ's prompt, and a
     * branch whose API is unreachable still has a printer on the counter.
     */
    private readonly prepare: () => Promise<void> = defaultPrepare,
  ) {}

  async print(job: PrintJob): Promise<PrintResult> {
    const profile = profileFor(this.config, job.kind);

    if (!profile.name) {
      return {
        ok: false,
        attempts: 0,
        error: 'No printer selected. Set the branch printer in Print settings.',
      };
    }

    const attemptsAllowed = Math.max(1, this.config.retryAttempts);
    let lastError = 'Printing failed.';

    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
      const outcome = await this.attempt(job, profile);

      if (outcome.ok) {
        return { ok: true, attempts: attempt, printerName: profile.name };
      }

      lastError = outcome.error ?? lastError;

      // A misconfigured printer will not fix itself; only transient faults are
      // worth a retry. Backing off on a permanent error just delays the message.
      if (!outcome.retryable || attempt === attemptsAllowed) {
        break;
      }

      await this.sleep(attempt * 400);
    }

    return { ok: false, attempts: attemptsAllowed, error: lastError, printerName: profile.name };
  }

  private async attempt(
    job: PrintJob,
    profile: PrinterProfile,
  ): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
    try {
      if (!this.qz.websocket.isActive()) {
        // Preparing is best-effort and never costs the print: a branch with no
        // certificate, or one whose API this counter cannot reach, still has a
        // printer on the desk. Its failure must not be reported as QZ being
        // down either — that sends somebody to restart the wrong thing.
        try {
          await this.prepare();
        } catch {
          // Unsigned, and printing.
        }
        await this.qz.websocket.connect();
      }
    } catch {
      // Connecting is what fails when the desktop app is not running. Worth a
      // retry — QZ may still be starting up when the first order lands.
      return {
        ok: false,
        retryable: true,
        error: 'QZ Tray is not running on this machine. Start QZ Tray, then retry.',
      };
    }

    try {
      const printerConfig = this.qz.configs.create(profile.name, { copies: profile.copies });
      await this.qz.print(printerConfig, buildPrintData(job.content, profile, job.logoBase64));

      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Printing failed.';

      return { ok: false, retryable: true, error: message };
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * By default the engine prepares nothing: signing is installed by whoever owns
 * an authenticated API client, and this module deliberately does not.
 * `setQzPrepare` is how the app hands one in at sign-in.
 */
let qzPrepare: () => Promise<void> = () => Promise.resolve();

export function setQzPrepare(prepare: () => Promise<void>): void {
  qzPrepare = prepare;
}

function defaultPrepare(): Promise<void> {
  return qzPrepare();
}

/**
 * Is QZ Tray actually running on this machine?
 *
 * The single most common reason a branch cannot print, and the one the old
 * screen surfaced only as a failed print job. Installing the QZ **desktop app**
 * and having it *running* are two different things, and so is having the JS
 * client — which this app bundles, so that part is never the branch's problem.
 */
export async function checkQzTray(qz: QzApi = resolveQz()): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!qz.websocket.isActive()) {
      // Signing first: this is usually the connection that opens the session,
      // and a socket opened unsigned prompts for the rest of it. Best-effort,
      // like the adapter's — an unreachable API must not read as QZ being down.
      await defaultPrepare().catch(() => undefined);
      await qz.websocket.connect();
    }

    // **Ask it something.** `isActive()` reports the client's own idea of its
    // socket, and it says yes while a connection is still being attempted — so
    // a machine with no QZ Tray at all was told "QZ Tray is running", with the
    // setup guide ticking the step green and the next one failing for a reason
    // that made no sense. A listing round-trips: an empty list is a real
    // answer from a running QZ, and a throw is the absence of one.
    await qz.printers.find();

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : 'QZ Tray is not running on this computer.',
    };
  }
}

export function createPrinter(
  config: PrinterConfig = getPrinterConfig(),
  qz?: QzApi,
  sleep?: (ms: number) => Promise<void>,
  prepare?: () => Promise<void>,
): Printer {
  return config.adapter === 'qz'
    ? new QzTrayPrinter(config, qz ?? resolveQz(), sleep, prepare)
    : new MockPrinter(config);
}

// --- Print log + duplicate-print prevention --------------------------------

export interface PrintLogEntry {
  orderId: string;
  orderNumber: string;
  kind: TicketKind;
  adapter: PrinterAdapterKind;
  ok: boolean;
  error?: string;
  at: string;
  printerName?: string;
  attempts?: number;
}

const LOG_KEY = 'rami.pos.printlog';
const LOG_CAP = 200;

export function getPrintLog(): PrintLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as PrintLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordPrint(entry: PrintLogEntry): void {
  try {
    const log = [entry, ...getPrintLog()].slice(0, LOG_CAP);
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    // ignore
  }
}

export function clearPrintLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore
  }
}

/** True if this exact ticket already printed successfully — guards double prints. */
export function hasPrinted(
  orderId: string,
  kind: TicketKind,
  log: PrintLogEntry[] = getPrintLog(),
): boolean {
  return log.some((e) => e.orderId === orderId && e.kind === kind && e.ok);
}

/**
 * Print, and record the outcome in one step.
 *
 * Every caller wants both, and a print that is not logged breaks the duplicate
 * guard and the "did it print?" answer — so this is the entry point screens use
 * rather than calling `createPrinter` and `recordPrint` separately and
 * occasionally forgetting the second.
 */
export async function printAndRecord(
  job: PrintJob,
  config: PrinterConfig = getPrinterConfig(),
): Promise<PrintResult> {
  const printer = createPrinter(config);
  const result = await printer.print(job);

  recordPrint({
    orderId: job.orderId,
    orderNumber: job.orderNumber,
    kind: job.kind,
    adapter: printer.adapter,
    ok: result.ok,
    error: result.error,
    at: new Date().toISOString(),
    printerName: result.printerName,
    attempts: result.attempts,
  });

  return result;
}
