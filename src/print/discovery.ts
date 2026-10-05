/**
 * Printer discovery and auto-setup.
 *
 * The counter staff who set up a branch are not IT people. Asking them to type
 * a printer's exact queue name — which is what the old settings screen did — is
 * how a branch ends up unable to print on opening day. So this module asks the
 * machine what printers it has, ranks them by how likely each is to be the
 * receipt printer, and infers a sensible profile (paper width, model label) from
 * the name, leaving a human to confirm rather than to know.
 *
 * The ranking and inference are **pure** and unit-tested. Only `discoverPrinters`
 * touches QZ, so everything that decides anything can be tested without hardware.
 *
 * Nothing here is authoritative: a heuristic picks the *default selection*, and
 * the operator can always override it. A wrong guess costs one dropdown change;
 * no guess at all costs a phone call.
 */
import { QzApi, resolveQz } from './qz-client';

/** Paper widths we support. 80mm is the common receipt roll; 58mm is the small one. */
export type PaperWidth = 58 | 80;

/** One printer as the machine reports it, plus what we inferred about it. */
export interface DiscoveredPrinter {
  /** Exact queue name — this is what gets sent to QZ, never a prettified version. */
  name: string;
  /** True when the OS reports this as the machine's default printer. */
  isSystemDefault: boolean;
  /** How likely this is the thermal receipt printer. Higher is better. */
  score: number;
  /** Why it scored — shown in the UI so the choice is explainable, not magic. */
  reason: string;
  /** Inferred model label and paper width; both are editable afterwards. */
  model: string;
  paperWidth: PaperWidth;
}

/**
 * Name fragments that identify a thermal receipt printer, with the weight each
 * contributes. Brand and series names score highest because they are specific;
 * generic words like "receipt" score lower because an office printer can be
 * named anything. Ordered most to least specific.
 */
const THERMAL_SIGNALS: ReadonlyArray<{ match: RegExp; weight: number; label: string }> = [
  { match: /\btm-?t\d/i, weight: 50, label: 'Epson TM-T series' },
  { match: /\btsp\s?\d/i, weight: 50, label: 'Star TSP series' },
  { match: /\brp\d{2,}/i, weight: 45, label: 'Rongta RP series' },
  { match: /\bxp-?\d{2,}/i, weight: 45, label: 'Xprinter XP series' },
  { match: /\bepson\b/i, weight: 30, label: 'Epson' },
  { match: /\bstar\b/i, weight: 30, label: 'Star' },
  { match: /\b(xprinter|rongta|bixolon|sewoo|citizen|zjiang|gprinter)\b/i, weight: 30, label: 'known thermal brand' },
  { match: /\bthermal\b/i, weight: 25, label: 'named “thermal”' },
  { match: /\breceipt\b/i, weight: 22, label: 'named “receipt”' },
  { match: /\bpos-?\d*\b/i, weight: 20, label: 'named “POS”' },
  { match: /\bticket\b/i, weight: 15, label: 'named “ticket”' },
  { match: /\bkitchen\b/i, weight: 12, label: 'named “kitchen”' },
  { match: /\b(80|58)\s?mm\b/i, weight: 12, label: 'roll width in the name' },
  { match: /\besc\/?pos\b/i, weight: 20, label: 'named “ESC/POS”' },
];

/**
 * Name fragments that mean "definitely not the receipt printer". These are
 * subtracted, not filtered, so an oddly-named device still appears in the list —
 * a branch that named its thermal printer "Microsoft Print to PDF" is unlikely,
 * but a branch whose only printer scores zero still needs to be pickable.
 */
const NOT_A_RECEIPT_PRINTER: ReadonlyArray<{ match: RegExp; weight: number; label: string }> = [
  { match: /\b(pdf|xps|onenote|fax|document\s?writer)\b/i, weight: 60, label: 'a virtual/document printer' },
  { match: /\b(laserjet|officejet|deskjet|pixma|ecotank|workforce|imageclass|photosmart)\b/i, weight: 40, label: 'an office/inkjet printer' },
  { match: /\b(a4|a3|duplex|scanner)\b/i, weight: 20, label: 'office paper handling' },
];

/**
 * 58mm rolls are usually named as such; everything else defaults to 80mm,
 * which is the common receipt roll. Getting this wrong only affects line
 * wrapping, and it is editable in the settings screen.
 */
export function inferPaperWidth(name: string): PaperWidth {
  return /\b58\s?mm\b/i.test(name) || /\bxp-?58\b/i.test(name) ? 58 : 80;
}

/**
 * A human-readable model label inferred from the queue name.
 *
 * Queue names are often already the model ("EPSON TM-T20III Receipt"), so the
 * cheapest correct answer is usually to tidy the name rather than to guess.
 */
export function inferModel(name: string): string {
  const cleaned = name
    .replace(/\b(copy|receipt|printer|thermal|driver)\b/gi, ' ')
    .replace(/[_(){}[\]]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned : name;
}

/** Scores one printer name. Pure — this is the whole of the guessing logic. */
export function scorePrinterName(name: string): { score: number; reason: string } {
  const hits: string[] = [];
  let score = 0;

  for (const signal of THERMAL_SIGNALS) {
    if (signal.match.test(name)) {
      score += signal.weight;
      hits.push(signal.label);
    }
  }

  for (const signal of NOT_A_RECEIPT_PRINTER) {
    if (signal.match.test(name)) {
      score -= signal.weight;
      hits.push(`not: ${signal.label}`);
    }
  }

  return {
    score,
    reason: hits.length > 0 ? hits.join(', ') : 'no recognisable thermal-printer name',
  };
}

/**
 * Ranks discovered printer names, best candidate first.
 *
 * The system default gets a small nudge rather than a decisive one: on a POS
 * machine the receipt printer usually *is* the default, but on a shared office
 * machine it is usually the A4 printer, and the name is the stronger signal in
 * both cases.
 */
export function rankPrinters(names: readonly string[], systemDefault?: string | null): DiscoveredPrinter[] {
  return names
    .map((name) => {
      const { score, reason } = scorePrinterName(name);
      const isSystemDefault = Boolean(systemDefault && systemDefault === name);

      return {
        name,
        isSystemDefault,
        score: score + (isSystemDefault ? 10 : 0),
        reason: isSystemDefault ? `${reason}; system default` : reason,
        model: inferModel(name),
        paperWidth: inferPaperWidth(name),
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * The printer to preselect, or `null` when nothing looks like a receipt printer.
 *
 * Returning `null` rather than "the least-bad option" is deliberate: silently
 * selecting an A4 printer means the first order of the day prints a full page
 * and someone has to work out why. An unset picker asks the question instead.
 */
export function suggestMainPrinter(ranked: readonly DiscoveredPrinter[]): DiscoveredPrinter | null {
  const best = ranked[0];

  return best && best.score > 0 ? best : null;
}

/**
 * A second printer for kitchen tickets, when one is obviously present.
 *
 * Only suggested when a *different* printer scores and its name mentions the
 * kitchen — two thermal printers where neither says "kitchen" is more likely to
 * be a spare than a second station, and guessing wrong sends the food order to
 * the customer-facing printer.
 */
export function suggestKitchenPrinter(
  ranked: readonly DiscoveredPrinter[],
  main: DiscoveredPrinter | null,
): DiscoveredPrinter | null {
  const candidate = ranked.find((p) => p.name !== main?.name && /\bkitchen\b/i.test(p.name));

  return candidate ?? null;
}

export interface DiscoveryResult {
  printers: DiscoveredPrinter[];
  suggestedMain: DiscoveredPrinter | null;
  suggestedKitchen: DiscoveredPrinter | null;
  /** Set when discovery could not run at all; `printers` is then empty. */
  error?: string;
}

/**
 * Asks the machine what printers it has, via QZ Tray.
 *
 * Fails soft and specifically: the operator needs to know whether QZ is not
 * running (their problem, fixable) or whether it is running and found nothing
 * (a driver problem). A thrown exception here would just blank the screen.
 */
export async function discoverPrinters(qz: QzApi = resolveQz()): Promise<DiscoveryResult> {
  const empty = { printers: [], suggestedMain: null, suggestedKitchen: null };

  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }
  } catch {
    return {
      ...empty,
      error: 'QZ Tray is not running on this machine. Start QZ Tray, then search again.',
    };
  }

  let names: string[];
  let systemDefault: string | null = null;

  try {
    names = await qz.printers.find();
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : 'Could not list printers.' };
  }

  try {
    systemDefault = await qz.printers.getDefault();
  } catch {
    // Not fatal — the default is a nudge in the ranking, not a requirement.
    systemDefault = null;
  }

  if (!Array.isArray(names) || names.length === 0) {
    return {
      ...empty,
      error: 'QZ Tray is running but reports no printers. Check the printer is installed on this machine.',
    };
  }

  const printers = rankPrinters(names, systemDefault);
  const suggestedMain = suggestMainPrinter(printers);

  return {
    printers,
    suggestedMain,
    suggestedKitchen: suggestKitchenPrinter(printers, suggestedMain),
  };
}
