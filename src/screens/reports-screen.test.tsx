import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Reports tab.
 *
 * Mounting is the floor: a screen that throws in render blanks the tab, and
 * neither the pure range tests nor the ticket tests catch one. What is actually
 * held here is the part that is wrong *invisibly* — that the window sent to the
 * server is the branch's own local day rather than a UTC one, that a refusal
 * names the permission, and that an empty window does not read as a failure.
 */

const salesReport = vi.fn();
const vatReport = vi.fn();
const paymentsReport = vi.fn();
const reportKpis = vi.fn();
const printAndRecord = vi.fn();

// One object, not a fresh one per render: the real AuthProvider memoises its
// value, and a mock that does not would re-run the load effect on every render
// — a spin that looks exactly like a hang.
const api = {
  salesReport: (...a: unknown[]) => salesReport(...a),
  vatReport: (...a: unknown[]) => vatReport(...a),
  paymentsReport: (...a: unknown[]) => paymentsReport(...a),
  reportKpis: (...a: unknown[]) => reportKpis(...a),
};
// `actor` is one object mutated in place rather than a getter returning a new
// one. The real `AuthProvider` holds it in state, so it is referentially stable
// across renders — and the screen's load callback depends on it. A mock handing
// back a fresh object per render re-runs the effect on every render, which is a
// poll of nearly a thousand requests a second: the harness's fault, but
// indistinguishable from the screen hanging.
const actor: { permissions: string[]; email: string; roles: string[] } = {
  permissions: ['reports:read'],
  email: 'olaya@example.test',
  roles: ['KITCHEN'],
};
const auth = {
  api,
  actor,
  branch: { id: 'branch-1', name: 'Olaya', nameAr: null },
  branchId: 'branch-1',
};
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));

vi.mock('../print/printer', async () => {
  const actual = await vi.importActual<typeof import('../print/printer')>('../print/printer');
  return { ...actual, printAndRecord: (...a: unknown[]) => printAndRecord(...a) };
});

vi.mock('../print/logo', () => ({
  prepareLogo: vi.fn().mockResolvedValue(null),
  logoSource: vi.fn().mockReturnValue('/logo.jpeg'),
}));

vi.mock('../print/template', () => ({
  docketTemplate: vi.fn().mockReturnValue({ logoImageUrl: null }),
}));

const { ReportsScreen } = await import('./ReportsScreen');
const { LangProvider } = await import('../i18n/LangProvider');
const { ApiError } = await import('../api/http');

/**
 * Deliberately awkward fixtures: a window whose status list contains orders the
 * revenue figures exclude, a null delivery timing, and a payment method the
 * server sent as null. A screen that only renders against tidy data is not
 * known to survive a real evening.
 */
const SALES = {
  period: { from: 'x', to: 'y' },
  currency: 'SAR',
  statusBreakdown: [
    { status: 'CANCELLED', orders: 2, totalMinor: 9000 },
    { status: 'DELIVERED', orders: 11, totalMinor: 143000 },
  ],
  realised: {
    orders: 11,
    subtotalMinor: 130000,
    discountMinor: 2500,
    deliveryFeeMinor: 5500,
    chargesMinor: 1000,
    taxableBaseMinor: 124348,
    vatMinor: 18652,
    totalMinor: 143000,
  },
  charges: [{ name: 'Service fee', count: 11, grossMinor: 870, vatMinor: 130, totalMinor: 1000 }],
};
const VAT = {
  period: { from: 'x', to: 'y' },
  currency: 'SAR',
  basis: 'gross',
  note: 'Gross output VAT on realised sales.',
  byRate: [
    { vatRate: '0.1500', orders: 11, taxableBaseMinor: 124348, vatMinor: 18652, totalMinor: 143000 },
  ],
  totalVatMinor: 18652,
  totalTaxableBaseMinor: 124348,
};
const PAYMENTS = {
  period: { from: 'x', to: 'y' },
  currency: 'SAR',
  byStatus: [{ status: 'PAID', payments: 11, capturedMinor: 143000, refundedMinor: 2000 }],
  byMethod: [{ method: null, payments: 11, capturedMinor: 143000, refundedMinor: 2000 }],
  totals: {
    payments: 11,
    capturedMinor: 143000,
    refundedMinor: 2000,
    gatewayFeesMinor: 0,
    netCapturedMinor: 141000,
  },
};
const KPIS = {
  period: { from: 'x', to: 'y' },
  avgPrepTimeSeconds: 754,
  prepTimeSamples: 11,
  avgDeliveryTimeSeconds: null,
  deliveryTimeSamples: 0,
};

/**
 * The value rendered under a figure's own label.
 *
 * Several figures on this page legitimately carry the same amount — the total
 * taken and everything captured are the same money — so a bare text match
 * proves nothing about which figure is which, and would keep passing if two of
 * them were swapped.
 */
function figure(label: string): string | undefined {
  const labelEl = screen.queryByText(label);
  return labelEl?.nextElementSibling?.textContent ?? undefined;
}

function renderScreen() {
  return render(
    <LangProvider>
      <ReportsScreen />
    </LangProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actor.permissions = ['reports:read'];
  salesReport.mockResolvedValue(SALES);
  vatReport.mockResolvedValue(VAT);
  paymentsReport.mockResolvedValue(PAYMENTS);
  reportKpis.mockResolvedValue(KPIS);
  printAndRecord.mockResolvedValue({ ok: true });
});

describe('ReportsScreen', () => {
  it('renders the figures the server sent', async () => {
    renderScreen();

    // 1430.00 appears twice and legitimately so — it is the total taken and
    // also everything captured — so this asserts on the figure beside its own
    // label rather than on the number alone.
    await waitFor(() => expect(figure('Total taken')).toBe('SAR 1430.00'));
    // The VAT inside the total. It appears twice — here and as the VAT card's
    // own total — which is correct: they are the same tax stated in two places,
    // and if they ever disagreed one of them would be wrong.
    expect(screen.getAllByText(/SAR 186\.52/).length).toBe(2);
    expect(screen.getByText('VAT included in the total:')).toBeTruthy();
    expect(figure('Net taken')).toBe('SAR 1410.00');
    expect(screen.getByText('Service fee')).toBeTruthy();
    expect(screen.getByText('12m 34s')).toBeTruthy();
  });

  it('asks for the branch’s own local day, not a UTC day', async () => {
    // This is the whole reason `reportRange` exists. Riyadh runs at UTC+3, so a
    // UTC window would push three hours of this branch's own trade into the
    // wrong report every day, with nothing on screen saying so.
    renderScreen();

    await waitFor(() => expect(salesReport).toHaveBeenCalled());
    const [query] = salesReport.mock.calls[0] as [{ from: string; to: string; branchId: string }];

    const start = new Date(query.from);
    const end = new Date(query.to);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    // And the window ends inside the day, never at the next day's midnight —
    // the server's filter is inclusive, so that would count one order twice
    // across two reports that then disagree with each other.
    expect(end.getDate()).toBe(start.getDate());
    expect(query.branchId).toBe('branch-1');
  });

  it('sends the same window to all four reads', async () => {
    // Four reads of one window. If they drifted, the VAT on the page would be
    // for a different period than the total above it, and nothing would say so.
    renderScreen();

    await waitFor(() => expect(reportKpis).toHaveBeenCalled());
    const windows = [salesReport, vatReport, paymentsReport, reportKpis].map(
      (fn) => (fn.mock.calls[0] as [{ from: string; to: string }])[0],
    );
    const first = windows[0]!;
    for (const w of windows) {
      expect(w.from).toBe(first.from);
      expect(w.to).toBe(first.to);
    }
  });

  it('re-reads on a preset, over a different window', async () => {
    renderScreen();
    await waitFor(() => expect(salesReport).toHaveBeenCalledTimes(1));
    const today = (salesReport.mock.calls[0] as [{ from: string }])[0].from;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    });

    await waitFor(() => expect(salesReport).toHaveBeenCalledTimes(2));
    const yesterday = (salesReport.mock.calls[1] as [{ from: string }])[0].from;
    expect(new Date(yesterday).getTime()).toBeLessThan(new Date(today).getTime());
  });

  it('says an empty window is empty, rather than leaving zeroes to read as a failure', async () => {
    salesReport.mockResolvedValue({ ...SALES, statusBreakdown: [] });
    renderScreen();

    await waitFor(() => expect(screen.getByText(/No orders in these days/)).toBeTruthy());
  });

  it('names the missing permission when the server refuses', async () => {
    // A POS bundle outlives the deploy that widened the role, so the counter is
    // where this gap is met. "You do not have permission" with no cause is
    // resolvable only by someone with database access.
    actor.permissions = ['orders:kitchen'];
    salesReport.mockRejectedValue(new ApiError({
        message: 'You do not have permission to perform this action.',
        statusCode: 403,
        code: 'FORBIDDEN',
      }));
    renderScreen();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('reports:read'));
    expect(screen.getByRole('alert').textContent).toContain('olaya@example.test');
  });

  it('reports a 403 the account should not have got as a different fault', async () => {
    actor.permissions = ['reports:read'];
    salesReport.mockRejectedValue(new ApiError({
        message: 'You do not have permission to perform this action.',
        statusCode: 403,
        code: 'FORBIDDEN',
      }));
    renderScreen();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Naming a missing permission here would send an owner to change a role
    // that was never wrong.
    expect(screen.getByRole('alert').textContent).not.toContain('missing');
  });

  it('shows no figures at all when the reads failed', async () => {
    // The tab fails together on purpose: a sheet showing takings with no VAT is
    // one somebody reads as complete.
    salesReport.mockRejectedValue(new ApiError({ message: 'Service unavailable.', statusCode: 503, code: 'INTERNAL' }));
    renderScreen();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Total taken')).toBeNull();
  });

  it('refuses a backwards range and says so instead of showing the old figures', async () => {
    renderScreen();
    await waitFor(() => expect(salesReport).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2030-01-01' } });
    });

    expect(screen.getByRole('alert').textContent).toContain('not after the end day');
    // And nothing was re-fetched under a window that does not exist.
    expect(salesReport).toHaveBeenCalledTimes(1);
  });

  it('prints the sheet through the printing code, and logs it as a report', async () => {
    renderScreen();
    await waitFor(() => expect(figure('Total taken')).toBe('SAR 1430.00'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Print this report' }));
    });

    await waitFor(() => expect(printAndRecord).toHaveBeenCalled());
    const [job] = printAndRecord.mock.calls[0] as [{ kind: string; content: string }];
    expect(job.kind).toBe('report');
    // The content is the builder's, not a second layout: the sheet on the roll
    // and the sheet in `tickets.test.ts` are the same document.
    expect(job.content).toContain('SALES REPORT');
    expect(job.content).toContain('This is not a tax');
    expect(screen.getByText('Sent to the printer.')).toBeTruthy();
  });

  it('says a print failed rather than looking like it worked', async () => {
    printAndRecord.mockResolvedValue({ ok: false, error: 'offline' });
    renderScreen();
    await waitFor(() => expect(figure('Total taken')).toBe('SAR 1430.00'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Print this report' }));
    });

    await waitFor(() => expect(screen.getByText('The printer did not take the job.')).toBeTruthy());
  });

  it('renders a null payment method and a null timing without blanking', async () => {
    // Both arrive from the real API. `—` is the answer for a timing with
    // nothing to average; "0s" would read as instant delivery.
    renderScreen();

    await waitFor(() => expect(figure('Total taken')).toBe('SAR 1430.00'));
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/Nothing finished in this window/)).toBeTruthy();
  });
});
