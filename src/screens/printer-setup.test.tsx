import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The screen a branch meets on opening day.
 *
 * Each case here is a way setting up a printer actually fails at a counter,
 * and what the person standing there is asked to do about it. The assertions
 * are about the words on the screen as much as the state, because the whole
 * point of this screen is that the answer is one somebody can act on.
 */

const checkQzTray = vi.fn();
const discoverPrinters = vi.fn();
const printAndRecord = vi.fn();
const savePrinterConfig = vi.fn();

vi.mock('../print/printer', async () => {
  const actual = await vi.importActual<typeof import('../print/printer')>('../print/printer');
  return {
    ...actual,
    checkQzTray: (...args: unknown[]) => checkQzTray(...args),
    printAndRecord: (...args: unknown[]) => printAndRecord(...args),
    savePrinterConfig: (...args: unknown[]) => savePrinterConfig(...args),
  };
});

vi.mock('../print/discovery', async () => {
  const actual = await vi.importActual<typeof import('../print/discovery')>('../print/discovery');
  return { ...actual, discoverPrinters: (...args: unknown[]) => discoverPrinters(...args) };
});

vi.mock('../print/template', () => ({ docketLogo: vi.fn().mockResolvedValue(null) }));

const configureQzSigning = vi.fn();
vi.mock('../print/qz-signing', () => ({
  configureQzSigning: (...args: unknown[]) => configureQzSigning(...args),
}));

const qzCertificate = vi.fn();
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api: { qzCertificate: (...a: unknown[]) => qzCertificate(...a) } }),
}));

const { PrinterSetup } = await import('./PrinterSetup');
const { LangProvider } = await import('../i18n/LangProvider');
const { DEFAULT_PRINTER_CONFIG } = await import('../print/printer');

const RECEIPT_PRINTER = {
  name: 'EPSON TM-T20III Receipt',
  model: 'Epson TM-T20III',
  paperWidth: 80 as const,
  score: 10,
  reason: 'looks like a receipt printer',
};
const OFFICE_PRINTER = {
  name: 'HP LaserJet',
  model: 'Generic ESC/POS',
  paperWidth: 80 as const,
  score: -5,
  reason: 'the system default',
};

function setup(overrides: Partial<typeof DEFAULT_PRINTER_CONFIG> = {}) {
  const onConfig = vi.fn();
  render(
    <LangProvider>
      <PrinterSetup config={{ ...DEFAULT_PRINTER_CONFIG, ...overrides }} onConfig={onConfig} />
    </LangProvider>,
  );
  return onConfig;
}

beforeEach(() => {
  qzCertificate.mockResolvedValue('-----BEGIN CERTIFICATE-----\nMIIBmock\n-----END CERTIFICATE-----');
  configureQzSigning.mockResolvedValue({ signing: true });
  checkQzTray.mockResolvedValue({ ok: true });
  discoverPrinters.mockResolvedValue({ printers: [RECEIPT_PRINTER], suggestedMain: RECEIPT_PRINTER });
  printAndRecord.mockResolvedValue({ ok: true, printerName: RECEIPT_PRINTER.name });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('setting up a printer', () => {
  it('finds it, picks it and prints a test with no questions asked', async () => {
    const onConfig = setup();

    await screen.findByRole('button', { name: 'It looks right' });
    // Chosen, saved, and the mode inferred: nobody was asked what a QZ Tray is.
    const saved = savePrinterConfig.mock.calls[0]?.[0];
    expect(saved.adapter).toBe('qz');
    expect(saved.main.name).toBe(RECEIPT_PRINTER.name);
    expect(onConfig).toHaveBeenCalled();
    expect(printAndRecord).toHaveBeenCalledTimes(1);
  });

  it('says QZ Tray is not running, and offers the two things that fix it', async () => {
    // The most common failure by a distance, and the old screen surfaced it
    // only as a failed print job.
    checkQzTray.mockResolvedValue({ ok: false, error: 'connection refused' });
    setup();

    // Waits on the **link**, not on the sentence. Step 2 says "QZ Tray is not
    // running on this computer." from the very first render — `qzRunning`
    // starts false — so a `findByText` on that wording matches the *initial*
    // state and synchronises nothing: the two awaits inside `start()` may not
    // have committed `no-qz` yet, and the link and the Check again button only
    // exist once they have. That is a race the suite won locally and lost on a
    // loaded CI runner, which is exactly the kind that lands as "passes on my
    // machine". The link is the first thing that is true only in the final
    // state, so it is what the test waits for.
    expect(await screen.findByRole('link', { name: 'Get QZ Tray' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    // And the banner names the blocking step — asserted on its own wording,
    // with the step number, rather than on a sentence step 2 also carries.
    expect(screen.getByText('QZ Tray is not running on this computer (step 2).')).toBeTruthy();
    // Nothing was printed and nothing was saved: there was nothing to save.
    expect(printAndRecord).not.toHaveBeenCalled();
    expect(savePrinterConfig).not.toHaveBeenCalled();
  });

  it('retries the whole thing once QZ Tray has been started', async () => {
    checkQzTray.mockResolvedValueOnce({ ok: false, error: 'refused' }).mockResolvedValue({ ok: true });
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));

    await screen.findByRole('button', { name: 'It looks right' });
    expect(printAndRecord).toHaveBeenCalledTimes(1);
  });

  it('offers the list when nothing looks like a receipt printer', async () => {
    // `suggestMainPrinter` returns null rather than picking the least-bad
    // option: an unset picker asks the question, a wrong auto-pick prints a
    // full A4 page and nobody knows why.
    discoverPrinters.mockResolvedValue({ printers: [OFFICE_PRINTER], suggestedMain: null });
    setup();

    await screen.findByText('Pick the receipt printer:');
    expect(screen.getByText(OFFICE_PRINTER.name)).toBeTruthy();
    expect(printAndRecord).not.toHaveBeenCalled();
  });

  it('fixes a roll that is the wrong width from the symptom, and reprints', async () => {
    // The one setting a person cannot look up and the printer will not report.
    // It is asked as "the text ran off the edge", because that is what they can
    // see, and the fix is one press.
    setup();
    await screen.findByRole('button', { name: 'It looks right' });

    fireEvent.click(screen.getByRole('button', { name: 'The text ran off the edge' }));

    await waitFor(() => expect(printAndRecord).toHaveBeenCalledTimes(2));
    const calls = savePrinterConfig.mock.calls;
    const second = calls[calls.length - 1]?.[0];
    expect(second.main.paperWidth).toBe(58);
  });

  it('goes back to the list when nothing came out', async () => {
    setup();
    await screen.findByRole('button', { name: 'It looks right' });

    fireEvent.click(screen.getByRole('button', { name: 'Nothing came out' }));

    expect(await screen.findByText('Pick the receipt printer:')).toBeTruthy();
  });

  it('signs before probing QZ, or the session is prompted anyway', async () => {
    // `checkQzTray` is usually what opens the socket, and QZ reads the
    // certificate at that moment. Signing installed afterwards changes nothing
    // until the next reconnect.
    const order: string[] = [];
    configureQzSigning.mockImplementation(async () => {
      order.push('sign');
      return { signing: true };
    });
    checkQzTray.mockImplementation(async () => {
      order.push('check');
      return { ok: true };
    });

    setup();
    await screen.findByRole('button', { name: 'It looks right' });

    expect(order.slice(0, 2)).toEqual(['sign', 'check']);
  });

  it('tells a branch when prints will still be prompted', async () => {
    configureQzSigning.mockResolvedValue({ signing: false });
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'Existing', model: 'Epson' } });

    expect(await screen.findByText(/this computer needs the restaurant/)).toBeTruthy();
  });

  it('sets up even when signing cannot be arranged', async () => {
    // A certificate is an improvement to printing, never a precondition for it.
    configureQzSigning.mockRejectedValue(new Error('offline'));
    setup();

    await screen.findByRole('button', { name: 'It looks right' });
    expect(printAndRecord).toHaveBeenCalledTimes(1);
  });

  it('offers the certificate installer as one file, once printing is signed', async () => {
    // The whole cost of a self-signed certificate is this step, so it is one
    // press: the script is built with the certificate already inside it.
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'Existing', model: 'Epson' } });

    const button = await screen.findByRole('button', { name: /Download the certificate installer/ });
    const click = vi.fn();
    const anchor = { href: '', download: '', click, remove: vi.fn() } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);
    vi.spyOn(document.body, 'appendChild').mockReturnValueOnce(anchor as never);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x');
    URL.revokeObjectURL = vi.fn();

    fireEvent.click(button);

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(qzCertificate).toHaveBeenCalled();
    expect(anchor.download).toContain('install-printer-certificate');
  });

  it('says printing still works when the certificate cannot be fetched', async () => {
    // A nuisance, not a fault: the branch prints and is prompted once a session.
    qzCertificate.mockRejectedValue(new Error('503'));
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'Existing', model: 'Epson' } });

    fireEvent.click(await screen.findByRole('button', { name: /Download the certificate installer/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Printing still works');
  });

  it('reads as five numbered steps, including the ones the app cannot do', async () => {
    // A screen that starts at "choose a printer" assumes the hard part — the
    // cable, the paper, the program — is already done. Most of what goes wrong
    // at a counter is in those steps.
    setup();
    await screen.findByRole('button', { name: 'It looks right' });

    expect(screen.getByText('Plug the printer in')).toBeTruthy();
    expect(screen.getByText('Start QZ Tray')).toBeTruthy();
    expect(screen.getByText('Choose the printer')).toBeTruthy();
    expect(screen.getByText('Print a test and look at it')).toBeTruthy();
    expect(screen.getByText(/Stop the .allow printing. question/)).toBeTruthy();
  });

  it('gives every chip a ground it can be read on', async () => {
    // The first version used a token that does not exist, with white text, so
    // three of the five chips were white on near-white and said nothing.
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'EPSON', model: 'Epson' } });
    await screen.findByText(/The printer is ready/);

    for (const label of ['Check this', 'Done', 'Optional']) {
      const chip = screen.getAllByText(label)[0];
      expect(chip).toBeTruthy();
      const style = (chip as HTMLElement).style;
      expect(style.background).not.toBe('');
      expect(style.color).not.toBe('rgb(255, 255, 255)');
    }
  });

  it('never ticks the step nothing can verify', async () => {
    // No API says whether a cable is in or a roll is the right way up. A tick
    // on that tells a cashier to stop looking at the step that is wrong.
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'EPSON TM-T20III Receipt', model: 'Epson' } });
    await screen.findByText(/The printer is ready/);

    const plugItIn = screen.getByText('Plug the printer in').closest('li');
    expect(plugItIn?.textContent).toContain('Check this');
    expect(plugItIn?.textContent).not.toContain('Done');
  });

  it('says why nothing will print, before anyone has to ask', async () => {
    // "It isn't printing" is the report that reaches an owner. The screen
    // answers it at the top rather than leaving a cashier to work out which
    // green tick is missing.
    checkQzTray.mockResolvedValue({ ok: false, error: 'refused' });
    setup();

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('This is what is stopping it right now');
    expect(status.textContent).toContain('QZ Tray is not running on this computer (step 2)');
  });

  it('names the missing printer as the reason once QZ is up', async () => {
    discoverPrinters.mockResolvedValue({ printers: [OFFICE_PRINTER], suggestedMain: null });
    setup();

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('No printer has been chosen yet (step 3)');
  });

  it('blames the cable when the computer sees no printers at all', async () => {
    // Which is the honest consequence of step 1 going wrong, and the only
    // evidence software has of it.
    discoverPrinters.mockResolvedValue({ printers: [], suggestedMain: null });
    setup();

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('no printers at all');
    expect(status.textContent).toContain('step 1');
  });

  it('gives the printer’s own words when a test fails', async () => {
    printAndRecord.mockResolvedValue({ ok: false, error: 'The printer is offline.' });
    setup();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The printer did not take the job:');
    expect(alert.textContent).toContain('The printer is offline.');
  });

  it('marks a step done from the real state, not from a button press', async () => {
    // "Done" has to mean done. A cashier who ticks a box they have not done is
    // a cashier who cannot tell which step they are stuck on — so every chip is
    // read off the machine's own state, and the printer's name is read off the
    // configuration the parent holds rather than from anything typed here.
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'EPSON TM-T20III Receipt', model: 'Epson' } });

    await screen.findByText(/The printer is ready/);
    expect(screen.getByText(/Printing to EPSON TM-T20III Receipt/)).toBeTruthy();
    // Plugged in, QZ running, printer chosen, test confirmed.
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(3);
  });

  it('points at the step that is actually blocking', async () => {
    checkQzTray.mockResolvedValue({ ok: false, error: 'refused' });
    setup();

    await screen.findByText(/QZ Tray is not running on this computer/);
    // The blocking steps are marked to do now, and nothing is marked done —
    // a green tick on a step that is not done is worse than no guide at all.
    expect(screen.getAllByText('Do this now').length).toBeGreaterThan(0);
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('is readable by a cashier who reads Arabic', async () => {
    // The whole point of a guide is that the person following it can read it.
    localStorage.setItem('rami.pos.lang', 'ar');
    setup();

    expect(await screen.findByText('إعداد الطابعة')).toBeTruthy();
    expect(screen.getByText('وصّل الطابعة')).toBeTruthy();
    expect(screen.getByText('شغّل برنامج QZ Tray')).toBeTruthy();
    localStorage.clear();
  });

  it('tells the cashier what to say when they are stuck', async () => {
    // A step number is something a cashier can read down a phone; "it doesn't
    // print" is not.
    setup();

    expect(await screen.findByText(/which step number you are on/)).toBeTruthy();
  });

  it('leaves a branch that is already set up alone', async () => {
    // A heuristic disagreeing with a working branch is how a working branch
    // stops working after an unrelated visit to this screen.
    setup({ adapter: 'qz', main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'Existing', model: 'Epson' } });

    await screen.findByText(/The printer is ready\./);
    expect(printAndRecord).not.toHaveBeenCalled();
    expect(savePrinterConfig).not.toHaveBeenCalled();
  });
});
