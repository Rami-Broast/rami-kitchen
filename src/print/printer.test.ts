import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PRINTER_CONFIG,
  DEFAULT_PROFILE,
  PrintLogEntry,
  PrinterConfig,
  createPrinter,
  frameForPrinter,
  hasPrinted,
  migrateConfig,
  profileFor,
  buildPrintData,
  checkQzTray,
} from './printer';
import type { QzApi } from './qz-client';

const log: PrintLogEntry[] = [
  { orderId: 'o1', orderNumber: 'ORD-1', kind: 'kitchen', adapter: 'mock', ok: true, at: '2026-08-23T10:00:00Z' },
  { orderId: 'o2', orderNumber: 'ORD-2', kind: 'kitchen', adapter: 'mock', ok: false, error: 'x', at: '2026-08-23T10:01:00Z' },
];

/** A QZ double: records what was printed, and fails on demand. */
function fakeQz(behaviour: { failPrints?: number; neverConnects?: boolean } = {}): {
  qz: QzApi;
  printed: string[];
  configs: Array<{ printer: string; options?: Record<string, unknown> }>;
} {
  const printed: string[] = [];
  const configs: Array<{ printer: string; options?: Record<string, unknown> }> = [];
  let failuresLeft = behaviour.failPrints ?? 0;

  const qz: QzApi = {
    websocket: {
      isActive: () => false,
      connect: () =>
        behaviour.neverConnects ? Promise.reject(new Error('no qz')) : Promise.resolve(),
    },
    printers: { find: () => Promise.resolve([]), getDefault: () => Promise.resolve(null) },
    configs: {
      create: (printer: string, options?: Record<string, unknown>) => {
        configs.push({ printer, options });
        return { printer };
      },
    },
    print: (_config: unknown, data: unknown[]) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return Promise.reject(new Error('printer busy'));
      }
      printed.push(String(data[0]));
      return Promise.resolve();
    },
  };

  return { qz, printed, configs };
}

const qzConfig: PrinterConfig = {
  ...DEFAULT_PRINTER_CONFIG,
  adapter: 'qz',
  main: { ...DEFAULT_PROFILE, name: 'EPSON TM-T20III', model: 'Epson TM-T20III' },
};

const job = { kind: 'docket' as const, orderId: 'o1', orderNumber: 'ORD-1', content: 'ticket' };

describe('hasPrinted (duplicate-print guard)', () => {
  it('is true only for a prior successful print of the same order+kind', () => {
    expect(hasPrinted('o1', 'kitchen', log)).toBe(true);
    expect(hasPrinted('o1', 'docket', log)).toBe(false); // different document
    expect(hasPrinted('o2', 'kitchen', log)).toBe(false); // failed print doesn't count
    expect(hasPrinted('nope', 'kitchen', log)).toBe(false);
  });
});

describe('config migration', () => {
  it('carries a pre-roles config onto the main printer instead of dropping it', () => {
    // A machine upgraded mid-service must not silently lose its printer and
    // start printing nowhere.
    const migrated = migrateConfig({ adapter: 'qz', model: 'Star TSP143III', connection: 'STAR-1' });

    expect(migrated.adapter).toBe('qz');
    expect(migrated.main.name).toBe('STAR-1');
    expect(migrated.main.model).toBe('Star TSP143III');
    expect(migrated.kitchen).toBeNull();
  });

  it('fills defaults for a partial current-shape config', () => {
    const migrated = migrateConfig({ adapter: 'qz', main: { name: 'P1' } });

    expect(migrated.main.paperWidth).toBe(80);
    expect(migrated.main.copies).toBe(1);
    expect(migrated.retryAttempts).toBe(DEFAULT_PRINTER_CONFIG.retryAttempts);
  });

  it('survives junk without throwing', () => {
    expect(migrateConfig(null).adapter).toBe('mock');
    expect(migrateConfig(undefined).main.name).toBe('');
  });
});

describe('routing a job to a device', () => {
  it('sends kitchen tickets to the main printer when no kitchen printer is set', () => {
    expect(profileFor(qzConfig, 'kitchen').name).toBe('EPSON TM-T20III');
  });

  it('sends kitchen tickets to the kitchen printer when one is set', () => {
    const withKitchen = { ...qzConfig, kitchen: { ...DEFAULT_PROFILE, name: 'KITCHEN-1' } };

    expect(profileFor(withKitchen, 'kitchen').name).toBe('KITCHEN-1');
    expect(profileFor(withKitchen, 'docket').name).toBe('EPSON TM-T20III');
  });
});

describe('ESC/POS framing', () => {
  it('wraps the ticket in initialise and cut when enabled', () => {
    const framed = frameForPrinter('hello', { ...DEFAULT_PROFILE, escPos: true });

    expect(framed.startsWith('\x1B\x40')).toBe(true);
    expect(framed.endsWith('\x1D\x56\x00')).toBe(true);
    // Feed before the cut, or the last lines are still under the head.
    expect(framed).toContain('hello\n\n\n');
  });

  it('sends plain text when the device does not obey ESC/POS', () => {
    const framed = frameForPrinter('hello', { ...DEFAULT_PROFILE, escPos: false });

    expect(framed).toBe('hello\n\n\n');
    expect(framed).not.toContain('\x1B');
  });
});

describe('createPrinter', () => {
  it('the mock adapter reports success without hardware', async () => {
    const result = await createPrinter(DEFAULT_PRINTER_CONFIG).print(job);

    expect(result.ok).toBe(true);
  });

  it('refuses before touching QZ when no printer is selected', async () => {
    const { qz, printed } = fakeQz();
    const result = await createPrinter({ ...qzConfig, main: { ...DEFAULT_PROFILE } }, qz).print(job);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No printer selected/i);
    expect(printed).toHaveLength(0);
  });

  it('prints through QZ with the configured name and copies', async () => {
    const { qz, printed, configs } = fakeQz();
    const config = { ...qzConfig, main: { ...qzConfig.main, copies: 2 } };

    const result = await createPrinter(config, qz).print(job);

    expect(result.ok).toBe(true);
    expect(configs[0]?.printer).toBe('EPSON TM-T20III');
    expect(configs[0]?.options).toEqual({ copies: 2 });
    expect(printed[0]).toContain('ticket');
  });

  it('retries a transient failure and succeeds', async () => {
    // A thermal printer that is briefly busy is the normal case mid-service.
    const { qz, printed } = fakeQz({ failPrints: 2 });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await createPrinter({ ...qzConfig, retryAttempts: 3 }, qz, sleep).print(job);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(printed).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts and reports the last error', async () => {
    const { qz } = fakeQz({ failPrints: 99 });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await createPrinter({ ...qzConfig, retryAttempts: 2 }, qz, sleep).print(job);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error).toMatch(/printer busy/i);
  });

  it('never claims success when retries are disabled and the device rejects', async () => {
    const { qz } = fakeQz({ failPrints: 1 });

    const result = await createPrinter({ ...qzConfig, retryAttempts: 1 }, qz).print(job);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it('says QZ Tray is not running when the connection cannot be made', async () => {
    const { qz } = fakeQz({ neverConnects: true });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await createPrinter({ ...qzConfig, retryAttempts: 2 }, qz, sleep).print(job);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/QZ Tray is not running/i);
  });
});

describe('the QZ Tray client is actually loaded', () => {
  /**
   * The regression guard for a bug this suite previously could not see.
   *
   * The adapter used to read `globalThis.qz` and nothing in the app ever loaded
   * that client — no dependency, no script tag — so every real print failed.
   * The old "fails clearly when QZ Tray is not running" test passed throughout,
   * because a missing client produced the very message it asserted: the test
   * agreed with the bug. So assert the thing that was missing.
   */
  it('exposes the surface the adapter and discovery use', async () => {
    const qz = (await import('qz-tray')).default as {
      websocket?: { isActive?: unknown; connect?: unknown };
      printers?: { find?: unknown; getDefault?: unknown };
      configs?: { create?: unknown };
      print?: unknown;
    };

    expect(typeof qz.websocket?.isActive).toBe('function');
    expect(typeof qz.websocket?.connect).toBe('function');
    expect(typeof qz.printers?.find).toBe('function');
    expect(typeof qz.printers?.getDefault).toBe('function');
    expect(typeof qz.configs?.create).toBe('function');
    expect(typeof qz.print).toBe('function');
  });
});

describe('buildPrintData', () => {
  const profile = { name: 'POS-80', model: 'Generic ESC/POS', paperWidth: 80 as const, copies: 1, escPos: true };

  it('sends only the text when there is no logo', () => {
    // Unchanged from before the logo existed: one string, framed.
    expect(buildPrintData('TICKET', profile)).toEqual([frameForPrinter('TICKET', profile)]);
    expect(buildPrintData('TICKET', profile, null)).toHaveLength(1);
  });

  it('sends the logo as its own image entry, in QZ’s shape', () => {
    // The raster encoding is the model-specific part and QZ is what does it —
    // which is the only reason a logo is safe to print on hardware nobody here
    // has tested against.
    const data = buildPrintData('TICKET', profile, 'AAAA');
    const image = data.find((entry) => typeof entry === 'object');

    expect(image).toEqual({
      type: 'raw',
      format: 'image',
      flavor: 'base64',
      data: 'AAAA',
      options: { language: 'ESCPOS', dotDensity: 'double' },
    });
  });

  it('initialises, centres the logo, returns to the left, and cuts last', () => {
    const data = buildPrintData('TICKET', profile, 'AAAA');
    const index = (needle: string): number =>
      data.findIndex((entry) => typeof entry === 'string' && entry.includes(needle));
    const imageIndex = data.findIndex((entry) => typeof entry === 'object');

    // ESC @ first, or a previous job's alignment puts the logo against the
    // margin; the cut last, or the receipt is cut before it is printed.
    expect(index('\x1B\x40')).toBe(0);
    expect(index('\x1B\x61\x01')).toBeLessThan(imageIndex);
    expect(index('\x1B\x61\x00')).toBeGreaterThan(imageIndex);
    expect(index('TICKET')).toBeGreaterThan(imageIndex);
    expect(index('\x1D\x56\x00')).toBe(data.length - 1);
  });

  it('sends no escape codes to a printer that does not obey them', () => {
    // A device that renders the bytes as text would print the codes as stray
    // characters across the customer's receipt.
    const plain = buildPrintData('TICKET', { ...profile, escPos: false }, 'AAAA');

    for (const entry of plain) {
      if (typeof entry === 'string') {
        expect(entry).not.toContain('\x1B');
        expect(entry).not.toContain('\x1D');
      }
    }
    // The logo still goes — QZ turns it into this printer's own raster.
    expect(plain.some((entry) => typeof entry === 'object')).toBe(true);
  });
});

describe('signing is installed before the socket opens', () => {
  function qzSpy(order: string[]) {
    let active = false;
    return {
      websocket: {
        isActive: () => active,
        connect: vi.fn(async () => {
          order.push('connect');
          active = true;
        }),
      },
      printers: { find: vi.fn(), getDefault: vi.fn() },
      configs: { create: vi.fn(() => ({})) },
      print: vi.fn(async () => {
        order.push('print');
      }),
    };
  }

  const job = { kind: 'docket' as const, orderId: 'o1', orderNumber: '1000001', content: 'TICKET' };
  const config = {
    ...DEFAULT_PRINTER_CONFIG,
    adapter: 'qz' as const,
    main: { ...DEFAULT_PRINTER_CONFIG.main, name: 'POS-80' },
  };

  it('prepares, then connects — QZ reads the certificate when the socket opens', async () => {
    // Installed afterwards, signing changes nothing until the next reconnect,
    // and the branch is prompted for the whole of this session.
    const order: string[] = [];
    const qz = qzSpy(order);
    const printer = createPrinter(config, qz as never, async () => {}, async () => {
      order.push('prepare');
    });

    await printer.print(job);

    expect(order).toEqual(['prepare', 'connect', 'print']);
  });

  it('prints anyway when preparing throws', async () => {
    // No certificate, or an API this counter cannot reach. The printer is on
    // the desk either way.
    const order: string[] = [];
    const qz = qzSpy(order);
    const printer = createPrinter(config, qz as never, async () => {}, async () => {
      throw new Error('unreachable');
    });

    const result = await printer.print(job);

    expect(result.ok).toBe(true);
  });
});

describe('checkQzTray', () => {
  function qz(overrides: Record<string, unknown> = {}) {
    return {
      websocket: { isActive: () => true, connect: vi.fn() },
      printers: { find: vi.fn().mockResolvedValue([]), getDefault: vi.fn() },
      configs: { create: vi.fn() },
      print: vi.fn(),
      ...overrides,
    } as never;
  }

  it('asks QZ something rather than trusting isActive()', async () => {
    // `isActive()` reports the client's own idea of its socket and says yes
    // while a connection is still being attempted, so a machine with no QZ
    // Tray at all was told it was running — the guide ticked the step green
    // and the next one failed for a reason that made no sense.
    const dead = qz({ printers: { find: vi.fn().mockRejectedValue(new Error('closed')), getDefault: vi.fn() } });

    await expect(checkQzTray(dead)).resolves.toMatchObject({ ok: false });
  });

  it('treats an empty printer list as a running QZ, because it is one', async () => {
    // "No printers" is a real answer from a working QZ Tray — a machine with
    // nothing plugged in yet. Only a throw means it is not there.
    await expect(checkQzTray(qz())).resolves.toEqual({ ok: true });
  });

  it('reports the failure when the socket will not open', async () => {
    const refused = qz({
      websocket: { isActive: () => false, connect: vi.fn().mockRejectedValue(new Error('refused')) },
    });

    await expect(checkQzTray(refused)).resolves.toMatchObject({ ok: false, error: 'refused' });
  });
});
