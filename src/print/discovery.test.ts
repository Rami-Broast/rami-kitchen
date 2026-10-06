import { describe, expect, it } from 'vitest';

import {
  discoverPrinters,
  inferModel,
  inferPaperWidth,
  rankPrinters,
  scorePrinterName,
  suggestKitchenPrinter,
  suggestMainPrinter,
} from './discovery';
import type { QzApi } from './qz-client';

/** A realistic mix from a counter machine that also has office printers. */
const REAL_WORLD = [
  'Microsoft Print to PDF',
  'HP LaserJet Pro M404dn',
  'EPSON TM-T20III Receipt',
  'Kitchen XP-80',
];

function fakeQz(over: Partial<QzApi> = {}): QzApi {
  return {
    websocket: { isActive: () => true, connect: () => Promise.resolve() },
    printers: { find: () => Promise.resolve(REAL_WORLD), getDefault: () => Promise.resolve(null) },
    configs: { create: () => ({}) },
    print: () => Promise.resolve(),
    ...over,
  } as QzApi;
}

describe('scorePrinterName', () => {
  it('scores thermal receipt printers above office printers', () => {
    expect(scorePrinterName('EPSON TM-T20III').score).toBeGreaterThan(
      scorePrinterName('HP LaserJet Pro M404dn').score,
    );
  });

  it('pushes virtual printers below zero so they are never suggested', () => {
    // Selecting "Print to PDF" as the receipt printer means the first order of
    // the day opens a save dialog instead of printing.
    expect(scorePrinterName('Microsoft Print to PDF').score).toBeLessThan(0);
    expect(scorePrinterName('Fax').score).toBeLessThan(0);
  });

  it('explains itself, so the suggestion is checkable rather than magic', () => {
    expect(scorePrinterName('EPSON TM-T88VI').reason).toMatch(/Epson/i);
    expect(scorePrinterName('Brother QL-800').reason).toMatch(/no recognisable/i);
  });
});

describe('inferPaperWidth', () => {
  it('reads 58mm from the name and defaults to 80mm otherwise', () => {
    expect(inferPaperWidth('Xprinter XP-58')).toBe(58);
    expect(inferPaperWidth('Thermal 58mm')).toBe(58);
    expect(inferPaperWidth('EPSON TM-T20III')).toBe(80);
    expect(inferPaperWidth('Kitchen XP-80')).toBe(80);
  });
});

describe('inferModel', () => {
  it('tidies the queue name rather than inventing a model', () => {
    expect(inferModel('EPSON TM-T20III Receipt')).toBe('EPSON TM-T20III');
    expect(inferModel('Kitchen_XP-80 (copy)')).toBe('Kitchen XP-80');
  });

  it('falls back to the raw name when tidying would empty it', () => {
    expect(inferModel('Receipt')).toBe('Receipt');
  });
});

describe('rankPrinters', () => {
  it('puts the thermal printer first and the virtual printer last', () => {
    const ranked = rankPrinters(REAL_WORLD);

    expect(ranked[0]?.name).toBe('EPSON TM-T20III Receipt');
    expect(ranked[ranked.length - 1]?.name).toBe('Microsoft Print to PDF');
  });

  it('nudges the system default without letting it beat a better name', () => {
    // On a shared machine the default is usually the A4 printer, so the name
    // has to stay the stronger signal.
    const ranked = rankPrinters(REAL_WORLD, 'HP LaserJet Pro M404dn');

    expect(ranked[0]?.name).toBe('EPSON TM-T20III Receipt');
    expect(ranked.find((p) => p.name === 'HP LaserJet Pro M404dn')?.isSystemDefault).toBe(true);
  });

  it('breaks ties by name so the list is stable between searches', () => {
    const a = rankPrinters(['POS-2', 'POS-1']);
    const b = rankPrinters(['POS-1', 'POS-2']);

    expect(a.map((p) => p.name)).toEqual(b.map((p) => p.name));
  });
});

describe('suggestMainPrinter', () => {
  it('suggests the best thermal candidate', () => {
    expect(suggestMainPrinter(rankPrinters(REAL_WORLD))?.name).toBe('EPSON TM-T20III Receipt');
  });

  it('suggests nothing when only office printers are present', () => {
    // An unset picker asks the question. Auto-selecting the least-bad option
    // means a full A4 page comes out and nobody knows why.
    expect(suggestMainPrinter(rankPrinters(['HP LaserJet Pro M404dn', 'Microsoft Print to PDF']))).toBeNull();
  });

  it('suggests nothing for an empty machine', () => {
    expect(suggestMainPrinter(rankPrinters([]))).toBeNull();
  });
});

describe('suggestKitchenPrinter', () => {
  it('suggests a second printer only when its name says kitchen', () => {
    const ranked = rankPrinters(REAL_WORLD);
    const main = suggestMainPrinter(ranked);

    expect(suggestKitchenPrinter(ranked, main)?.name).toBe('Kitchen XP-80');
  });

  it('does not guess a second thermal printer is the kitchen one', () => {
    // Two thermal printers where neither says "kitchen" is more likely a spare;
    // guessing sends the food order to the customer-facing printer.
    const ranked = rankPrinters(['EPSON TM-T20III', 'EPSON TM-T88VI']);

    expect(suggestKitchenPrinter(ranked, suggestMainPrinter(ranked))).toBeNull();
  });

  it('never suggests the printer already chosen as main', () => {
    const ranked = rankPrinters(['Kitchen XP-80']);
    const main = suggestMainPrinter(ranked);

    expect(suggestKitchenPrinter(ranked, main)).toBeNull();
  });
});

describe('discoverPrinters', () => {
  it('returns ranked printers and a suggestion', async () => {
    const result = await discoverPrinters(fakeQz());

    expect(result.error).toBeUndefined();
    expect(result.printers).toHaveLength(4);
    expect(result.suggestedMain?.name).toBe('EPSON TM-T20III Receipt');
    expect(result.suggestedKitchen?.name).toBe('Kitchen XP-80');
  });

  it('connects first when the socket is not already open', async () => {
    let connected = false;
    const qz = fakeQz({
      websocket: {
        isActive: () => false,
        connect: () => {
          connected = true;
          return Promise.resolve();
        },
      },
    });

    await discoverPrinters(qz);

    expect(connected).toBe(true);
  });

  it('distinguishes "QZ not running" from "QZ found nothing"', async () => {
    // These are different problems with different fixes, and an operator needs
    // to be told which one they have.
    const notRunning = await discoverPrinters(
      fakeQz({ websocket: { isActive: () => false, connect: () => Promise.reject(new Error('x')) } }),
    );
    expect(notRunning.error).toMatch(/QZ Tray is not running/i);

    const noPrinters = await discoverPrinters(
      fakeQz({ printers: { find: () => Promise.resolve([]), getDefault: () => Promise.resolve(null) } }),
    );
    expect(noPrinters.error).toMatch(/no printers/i);
  });

  it('still returns printers when the default cannot be read', async () => {
    // The default is a nudge in the ranking, not a requirement.
    const result = await discoverPrinters(
      fakeQz({
        printers: {
          find: () => Promise.resolve(REAL_WORLD),
          getDefault: () => Promise.reject(new Error('unsupported')),
        },
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.printers).toHaveLength(4);
  });

  it('reports a listing failure instead of throwing into the screen', async () => {
    const result = await discoverPrinters(
      fakeQz({
        printers: { find: () => Promise.reject(new Error('driver error')), getDefault: () => Promise.resolve(null) },
      }),
    );

    expect(result.printers).toEqual([]);
    expect(result.error).toMatch(/driver error/i);
  });
});
