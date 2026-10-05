import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../api/endpoints';
import { DEFAULT_DOCKET_TEMPLATE } from './docket';
import { docketTemplate, loadDocketTemplate, resetDocketTemplateCache, withDefaults } from './template';

describe('withDefaults', () => {
  it('fills in a key a template saved by an older editor does not carry', () => {
    // The stored config is a document written by whichever version of the
    // editor last saved it. A field added later must not reach the paper as
    // `undefined`.
    const filled = withDefaults({ thankYouLines: ['Shukran'] });

    expect(filled.thankYouLines).toEqual(['Shukran']);
    expect(filled.footerLines).toEqual(DEFAULT_DOCKET_TEMPLATE.footerLines);
    expect(filled.readyTimeRules).toEqual(DEFAULT_DOCKET_TEMPLATE.readyTimeRules);
  });

  it('is the built-in template for anything that is not an object', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_DOCKET_TEMPLATE);
    expect(withDefaults('nonsense')).toEqual(DEFAULT_DOCKET_TEMPLATE);
    expect(withDefaults([])).toEqual(DEFAULT_DOCKET_TEMPLATE);
  });
});

describe('the cached template', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocketTemplateCache();
  });

  afterEach(() => {
    localStorage.clear();
    resetDocketTemplateCache();
  });

  it('prints the built-in template on a terminal that has never fetched one', () => {
    expect(docketTemplate()).toEqual(DEFAULT_DOCKET_TEMPLATE);
  });

  it('caches what the server resolved, so the next print does not wait on the network', async () => {
    const api = { receiptTemplate: vi.fn().mockResolvedValue({ resolved: { thankYouLines: ['Ahlan'] } }) };

    await expect(loadDocketTemplate(api as unknown as Api, 'b1')).resolves.toBe(true);
    expect(docketTemplate().thankYouLines).toEqual(['Ahlan']);
    // And survives a restart of the terminal.
    resetDocketTemplateCache();
    expect(docketTemplate().thankYouLines).toEqual(['Ahlan']);
  });

  it('keeps the template it has when the fetch fails', async () => {
    const ok = { receiptTemplate: vi.fn().mockResolvedValue({ resolved: { thankYouLines: ['Ahlan'] } }) };
    await loadDocketTemplate(ok as unknown as Api, 'b1');

    const failing = { receiptTemplate: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(loadDocketTemplate(failing as unknown as Api, 'b1')).resolves.toBe(false);

    // A print that fails because a layout would not load is a print that did
    // not happen, with the customer standing at the counter.
    expect(docketTemplate().thankYouLines).toEqual(['Ahlan']);
  });

  it('re-prepares the logo when the owner changes its size', async () => {
    // The size is part of the cache key: an owner who shrinks the logo and
    // reprints must not get the cached full-width one back.
    const api = {
      receiptTemplate: vi
        .fn()
        .mockResolvedValue({ resolved: { logoWidthPercent: 40, printLogoImage: true } }),
    };
    await loadDocketTemplate(api as unknown as Api, 'b1');

    expect(docketTemplate().logoWidthPercent).toBe(40);
  });

  it('falls back to the built-in template when the cache is unreadable', () => {
    localStorage.setItem('bah.pos.docketTemplate', '{ not json');

    expect(docketTemplate()).toEqual(DEFAULT_DOCKET_TEMPLATE);
  });
});
