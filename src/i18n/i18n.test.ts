import { describe, expect, it } from 'vitest';

import { dirFor, pickName, translate } from './i18n';

describe('dirFor', () => {
  it('is rtl for Arabic and ltr for English', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
  });
});

describe('pickName', () => {
  it('uses the Arabic name when present and the language is Arabic', () => {
    expect(pickName('ar', { name: 'Shawarma', nameAr: 'شاورما' })).toBe('شاورما');
  });

  it('falls back to English when the Arabic name is missing', () => {
    expect(pickName('ar', { name: 'Shawarma', nameAr: null })).toBe('Shawarma');
    expect(pickName('ar', { name: 'Shawarma' })).toBe('Shawarma');
  });

  it('always uses English in English', () => {
    expect(pickName('en', { name: 'Shawarma', nameAr: 'شاورما' })).toBe('Shawarma');
  });
});

describe('translate', () => {
  it('returns the language-specific string for a known key', () => {
    expect(translate('en', 'placeOrder')).toBe('Place order');
    expect(translate('ar', 'placeOrder')).toBe('تأكيد الطلب');
  });

  it('returns the key itself for an unknown key, so a miss is visible', () => {
    expect(translate('en', 'nope.not.a.key')).toBe('nope.not.a.key');
  });
});

describe('the new POS screens have copy in both languages', () => {
  // A missing key renders as the key itself, which ships an English-looking
  // string into the Arabic UI. These are the keys the lookup and menu screens
  // depend on.
  const keys = [
    'navLookup',
    'navMenu',
    'lookupTitle',
    'lookupHint',
    'lookupPlaceholder',
    'search',
    'noMatches',
    'recentOrders',
    'reprint',
    'reprintKitchen',
    'placed',
    'status',
    'menuTitle',
    'menuHint',
    'soldOut',
    'available',
    'markSoldOut',
    'markAvailable',
    'filterItems',
    'couldNotSave',
    // The Reports tab. A missing key here renders as `reportsVatGross` on a
    // counter, which is a caveat nobody reads beside a VAT figure somebody
    // does.
    'navReports',
    'reportsTitle',
    'reportsHint',
    'reportsToday',
    'reportsYesterday',
    'reportsLast7',
    'reportsThisMonth',
    'reportsCustom',
    'reportsFrom',
    'reportsTo',
    'reportsBadRange',
    'reportsLocalDays',
    'reportsRefresh',
    'reportsPrint',
    'reportsPrinted',
    'reportsPrintFailed',
    'reportsRealised',
    'reportsRealisedHint',
    'reportsOrders',
    'reportsSubtotal',
    'reportsDiscounts',
    'reportsDeliveryFees',
    'reportsCharges',
    'reportsTotal',
    'reportsVatIncluded',
    'reportsVatInclusiveNote',
    'reportsByStatus',
    'reportsChargeBreakdown',
    'reportsCount',
    'reportsAmount',
    'reportsPayments',
    'reportsByMethod',
    'reportsMethod',
    'reportsStatus',
    'reportsCaptured',
    'reportsRefunded',
    'reportsNetTaken',
    'reportsCodPending',
    'reportsVat',
    'reportsVatRate',
    'reportsTaxableBase',
    'reportsTotalVat',
    'reportsVatGross',
    'reportsNotTaxInvoice',
    'reportsTimings',
    'reportsPrepTime',
    'reportsDeliveryTime',
    'reportsNoSamples',
    'reportsEmpty',
    'reportsNoRows',
    'reportsOneDay',
  ];

  it.each(keys)('%s is translated, not echoed back', (key) => {
    expect(translate('en', key)).not.toBe(key);
    expect(translate('ar', key)).not.toBe(key);
    // And the Arabic is actually Arabic, not the English string copied over.
    expect(translate('ar', key)).not.toBe(translate('en', key));
  });
});

describe('translate with variables', () => {
  it('fills a placeholder in both languages', () => {
    expect(translate('en', 'driverCarryingMany', { n: 3 })).toBe('Carrying 3 deliveries');
    expect(translate('ar', 'driverCarryingMany', { n: 3 })).toContain('3');
  });

  it('puts the number in both languages for the report counts', () => {
    // Arabic and English put a number in different places in these sentences,
    // which is why the count is a slot rather than something built at the call
    // site — a string assembled there is wrong in exactly one language, and
    // nobody who reads only the other ever sees it.
    expect(translate('en', 'reportsDays', { n: 7 })).toContain('7');
    expect(translate('ar', 'reportsDays', { n: 7 })).toContain('7');
    expect(translate('en', 'reportsSamples', { n: 12 })).toContain('12');
    expect(translate('ar', 'reportsSamples', { n: 12 })).toContain('12');
  });

  it('leaves an unfilled placeholder visible rather than printing "undefined"', () => {
    expect(translate('en', 'driverCarryingMany', {})).toContain('{n}');
  });

  it('is unchanged for keys with no placeholders', () => {
    expect(translate('en', 'driverFree')).toBe('Free');
    expect(translate('en', 'driverFree', { n: 9 })).toBe('Free');
  });
});

describe('the printer setup guide', () => {
  it('is written in both languages, because the cashier reads one of them', () => {
    // A guide in a language you do not read is a guide you ring somebody
    // about — which is the whole thing it exists to prevent.
    const keys = [
      'guideTitle',
      'guideIntro',
      'guideStep1',
      'guideStep1Body',
      'guideStep2',
      'guideStep2Body',
      'guideStep3',
      'guideStep4',
      'guideStep5',
      'guideLooksRight',
      'guideRanOff',
      'guideNothing',
      'guideNeedHelp',
      'guideBackToOrders',
      'guideAdvanced',
    ];

    for (const key of keys) {
      const en = translate('en', key);
      const ar = translate('ar', key);

      // `translate` returns the key itself when there is no entry, which is
      // how a missing string reaches a counter looking like `guideStep3Body`.
      expect(en).not.toBe(key);
      expect(ar).not.toBe(key);
      expect(ar).not.toBe(en);
    }
  });

  it('keeps the printer name as a slot rather than something built at the call site', () => {
    // Arabic and English put the name in different places in the sentence.
    expect(translate('en', 'guideStep3Chosen', { name: 'EPSON TM-T20' })).toContain('EPSON TM-T20');
    expect(translate('ar', 'guideStep3Chosen', { name: 'EPSON TM-T20' })).toContain('EPSON TM-T20');
  });
});

describe('the receipt tab', () => {
  it('is written in both languages, because the counter reads one of them', () => {
    // This tab is opened mid-service to answer "what does our receipt look
    // like?". A missing key renders as the key itself, which is an
    // English-looking string in the Arabic UI and a question somebody rings
    // about rather than answers.
    const keys = [
      'navReceipt',
      'receiptTitle',
      'receiptHint',
      'receiptTabDocket',
      'receiptTabKitchen',
      'receiptSample',
      'receiptPreviewLabel',
      'receiptPrintSample',
      'receiptRefresh',
      'receiptFromServer',
      'receiptFromCache',
      'receiptInEffect',
      'receiptOwnerOnly',
      'receiptBranchSettings',
      'receiptThankYou',
      'receiptReadyTime',
      'receiptSave',
      'receiptReset',
      'receiptUnsaved',
      'receiptSaved',
      'receiptNotSaved',
      'receiptReadOnly',
      'rsLogo',
      'rsItems',
      'rsTotals',
      'rsThankYou',
    ];

    for (const key of keys) {
      expect(translate('en', key), key).not.toBe(key);
      expect(translate('ar', key), key).not.toBe(key);
      expect(translate('ar', key), key).not.toBe(translate('en', key));
    }
  });

  it('puts the logo size into the sentence rather than building it at the call site', () => {
    // Arabic and English put the number in different places.
    expect(translate('en', 'receiptLogoOn', { percent: 50 })).toContain('50%');
    expect(translate('ar', 'receiptLogoOn', { percent: 50 })).toContain('50%');
  });
});
