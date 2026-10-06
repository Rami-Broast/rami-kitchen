import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Receipt tab.
 *
 * Two things are actually being held here, and neither is visible from the
 * screen: that the preview is produced by the **printing** code rather than a
 * second implementation of the layout, and that a branch's save reaches the
 * template the printer reads — not only the one on screen. A preview that
 * drifts from the printer is worse than no preview, because it is believed.
 */

const receiptTemplate = vi.fn();
const saveBranchReceiptTemplate = vi.fn();
const clearBranchReceiptTemplate = vi.fn();
const printAndRecord = vi.fn();
let permissions: string[] = [];

// One object, not a fresh one per render: the real `AuthProvider` memoises its
// value, and a mock that does not would make the screen's load effect re-run on
// every render — a spin that is the test harness's fault rather than the
// screen's, and which looks exactly like a hang.
const api = {
  receiptTemplate: (...a: unknown[]) => receiptTemplate(...a),
  saveBranchReceiptTemplate: (...a: unknown[]) => saveBranchReceiptTemplate(...a),
  clearBranchReceiptTemplate: (...a: unknown[]) => clearBranchReceiptTemplate(...a),
};
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api, actor: { permissions }, branchId: 'branch-1' }),
}));

vi.mock('../print/printer', async () => {
  const actual = await vi.importActual<typeof import('../print/printer')>('../print/printer');
  return { ...actual, printAndRecord: (...a: unknown[]) => printAndRecord(...a) };
});

// The logo goes through a canvas the test environment does not have. The text
// half of the docket is what these cases are about; `logo.test.ts` holds the
// rasterising.
vi.mock('../print/logo', async () => {
  const actual = await vi.importActual<typeof import('../print/logo')>('../print/logo');
  return { ...actual, prepareLogo: vi.fn().mockResolvedValue(null) };
});

const { ReceiptScreen } = await import('./ReceiptScreen');
const { LangProvider } = await import('../i18n/LangProvider');
const { DEFAULT_DOCKET_TEMPLATE } = await import('../print/docket');
const { docketTemplate, resetDocketTemplateCache } = await import('../print/template');

const OWNER_TEMPLATE = {
  ...DEFAULT_DOCKET_TEMPLATE,
  thankYouLines: ['Thank you!', 'Please visit again.'],
};

function renderScreen() {
  return render(
    <LangProvider>
      <ReceiptScreen />
    </LangProvider>,
  );
}

function previewText(): string {
  return screen.getByLabelText('Receipt preview').textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  resetDocketTemplateCache();
  permissions = ['receipt-template:read', 'receipt-template:branch'];
  receiptTemplate.mockResolvedValue({
    resolved: OWNER_TEMPLATE,
    organisationDefault: OWNER_TEMPLATE,
    override: {},
  });
  saveBranchReceiptTemplate.mockResolvedValue({ resolved: OWNER_TEMPLATE, override: {} });
  clearBranchReceiptTemplate.mockResolvedValue({ resolved: OWNER_TEMPLATE });
  printAndRecord.mockResolvedValue({ ok: true, printerName: 'EPSON TM-T20III' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the receipt preview', () => {
  it('is the document itself — the sample order, priced and laid out as it prints', async () => {
    renderScreen();
    await waitFor(() => expect(receiptTemplate).toHaveBeenCalledWith('branch-1'));

    const text = previewText();
    // Every one of these is produced by `buildDocket`, not by this screen: the
    // order type, the reference a customer quotes, the total actually charged,
    // and the line that keeps the document from reading as a tax invoice.
    expect(text).toContain('DELIVERY');
    expect(text).toContain('481903772651');
    expect(text).toContain('TOTAL PAID');
    expect(text).toContain('Not a tax invoice');
    // The awkward parts of the sample: a stacked promotion and coupon, and an
    // item note. A branch previewing only a tidy order has seen nothing.
    expect(text).toContain('WELCOME5');
    expect(text).toContain('10% off wraps');
  });

  it('wraps to the roll the branch actually has, and to the other one on request', async () => {
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    const at80 = previewText();
    // The width change re-prepares the logo, which settles a tick later; let it
    // land rather than assert through a render React has not finished.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /58mm/ }));
    });
    const at58 = previewText();

    // Not a cosmetic difference: the 58mm roll is 32 columns and the long dish
    // name has to wrap into it. If these matched, the preview would be lying to
    // whichever branch is not on 80mm.
    expect(at58).not.toBe(at80);
    const longest = (text: string): number =>
      Math.max(...text.split('\n').map((line) => line.length));
    expect(longest(at80)).toBeLessThanOrEqual(42);
    expect(longest(at58)).toBeLessThanOrEqual(32);
  });

  it('shows the kitchen ticket too, which carries no logo and no customer money', async () => {
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    fireEvent.click(screen.getByRole('button', { name: 'Kitchen ticket' }));
    const text = previewText();

    expect(text).toContain('1000042');
    // The kitchen's working document: no thank-you, and nothing that reads as
    // a receipt for the customer.
    expect(text).not.toContain('TOTAL PAID');
    expect(screen.queryByAltText('The logo as it will print')).toBeNull();
  });
});

describe('what a branch may change', () => {
  it('saves only the two fields the backend lets a branch set', async () => {
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    fireEvent.change(screen.getByLabelText(/Thank-you lines/), {
      target: { value: 'Shukran!\nSee you soon.' },
    });
    // The preview answers before the save does — this is the whole reason the
    // draft is previewed rather than only the stored template.
    expect(previewText()).toContain('Shukran!');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveBranchReceiptTemplate).toHaveBeenCalled());

    const [branchId, body] = saveBranchReceiptTemplate.mock.calls[0] as [string, Record<string, unknown>];
    expect(branchId).toBe('branch-1');
    expect(body.thankYouLines).toEqual(['Shukran!', 'See you soon.']);
    expect(body.readyTimeRules).toBeTruthy();
    // The layout, the brand lines and the footer are the owner's. Sending them
    // would be a 400 from the DTO, and the footer is what keeps this document
    // from reading as a tax invoice.
    expect(Object.keys(body).sort()).toEqual(['readyTimeRules', 'thankYouLines']);
  });

  it('puts what was saved in front of the printer, not only on the screen', async () => {
    // The failure this prevents: a branch changes its thank-you, sees the
    // preview update, and the counter keeps printing the old receipt until
    // somebody signs in again.
    const saved = { ...OWNER_TEMPLATE, thankYouLines: ['Shukran!'] };
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    receiptTemplate.mockResolvedValue({
      resolved: saved,
      organisationDefault: OWNER_TEMPLATE,
      override: { thankYouLines: ['Shukran!'] },
    });

    fireEvent.change(screen.getByLabelText(/Thank-you lines/), { target: { value: 'Shukran!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(docketTemplate().thankYouLines).toEqual(['Shukran!']));
    // And the print path reads it from the machine on the next start, too.
    expect(localStorage.getItem('bah.pos.docketTemplate')).toContain('Shukran!');
  });

  it('re-reads the server rather than trusting what was typed', async () => {
    // The branch override sits on top of the owner's template and the server is
    // what resolves the two. A screen that kept its own draft would print a
    // document the owner had changed underneath it.
    renderScreen();
    await screen.findByText(/Up to date with the server/);
    receiptTemplate.mockClear();

    fireEvent.change(screen.getByLabelText(/Thank-you lines/), { target: { value: 'Shukran!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(receiptTemplate).toHaveBeenCalledWith('branch-1'));
  });

  it('offers no Save to an account that cannot save, rather than one that answers 403', async () => {
    permissions = ['receipt-template:read'];
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByLabelText(/Thank-you lines/)).toBeNull();
    // …and says what the account can do instead of leaving a dead screen.
    expect(screen.getByText(/can see the receipt but not change it/)).toBeTruthy();
    // The preview is still the point of the screen and is still there.
    expect(previewText()).toContain('TOTAL PAID');
  });

  it('drops back to the owner’s settings only when there is an override to drop', async () => {
    receiptTemplate.mockResolvedValue({
      resolved: { ...OWNER_TEMPLATE, thankYouLines: ['Shukran!'] },
      organisationDefault: OWNER_TEMPLATE,
      override: { thankYouLines: ['Shukran!'] },
    });
    renderScreen();

    const reset = await screen.findByRole('button', { name: /Back to the owner/ });
    fireEvent.click(reset);
    await waitFor(() => expect(clearBranchReceiptTemplate).toHaveBeenCalledWith('branch-1'));
  });

  it('says a save was refused instead of looking like it worked', async () => {
    saveBranchReceiptTemplate.mockRejectedValue(new Error('Network request failed'));
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    fireEvent.change(screen.getByLabelText(/Thank-you lines/), { target: { value: 'Shukran!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not saved');
    expect(alert.textContent).toContain('Network request failed');
  });
});

describe('when the server cannot be reached', () => {
  it('previews the copy this machine will actually print, and says which it is', async () => {
    localStorage.setItem(
      'bah.pos.docketTemplate',
      JSON.stringify({ ...OWNER_TEMPLATE, thankYouLines: ['From the cache'] }),
    );
    resetDocketTemplateCache();
    receiptTemplate.mockRejectedValue(new Error('offline'));
    renderScreen();

    await screen.findByText(/Could not reach the server/);
    // Not the built-in default, and not an error screen: the template this
    // terminal is holding, which is the one the printer will use.
    expect(previewText()).toContain('From the cache');
  });
});

describe('printing the sample', () => {
  it('sends the stored template, not the half-typed draft', async () => {
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    fireEvent.change(screen.getByLabelText(/Thank-you lines/), { target: { value: 'Not saved yet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print this sample' }));

    await waitFor(() => expect(printAndRecord).toHaveBeenCalled());
    const [job] = printAndRecord.mock.calls[0] as [{ content: string; kind: string }];
    // A test print is for checking the printer against what it prints today.
    // Handing it an unsaved edit would answer a question nobody asked.
    expect(job.content).not.toContain('Not saved yet');
    expect(job.content).toContain('Thank you!');
    expect(job.kind).toBe('docket');
  });

  it('reports a printer that refused the job', async () => {
    printAndRecord.mockResolvedValue({ ok: false, error: 'Printer not found' });
    renderScreen();
    await screen.findByText(/Up to date with the server/);

    fireEvent.click(screen.getByRole('button', { name: 'Print this sample' }));
    expect((await screen.findByRole('status')).textContent).toContain('Printer not found');
  });
});
