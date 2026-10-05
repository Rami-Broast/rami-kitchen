import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../api/endpoints';
import { QzApi } from './qz-client';
import { configureQzSigning, resetQzSigning } from './qz-signing';

/**
 * Signing is what stops "allow this site to print?" appearing on a counter
 * every session. The failures worth holding are the quiet ones: promises
 * installed after the socket opened (which does nothing until the next
 * reconnect), installed twice, or a missing certificate taken as a reason to
 * stop printing.
 */
function qzWithSecurity() {
  const security = {
    setCertificatePromise: vi.fn(),
    setSignatureAlgorithm: vi.fn(),
    setSignaturePromise: vi.fn(),
  };
  return { security } as unknown as QzApi & { security: typeof security };
}

function apiWith(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    qzCertificate: vi.fn().mockResolvedValue('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'),
    qzSign: vi.fn().mockResolvedValue('c2lnbmF0dXJl'),
    ...overrides,
  } as unknown as Api;
}

beforeEach(() => {
  resetQzSigning();
});

describe('configureQzSigning', () => {
  it('installs the certificate, the algorithm and the signature promise', () => {
    const qz = qzWithSecurity();

    return configureQzSigning(apiWith(), qz).then((result) => {
      expect(result.signing).toBe(true);
      expect(qz.security.setCertificatePromise).toHaveBeenCalledTimes(1);
      // SHA-512 is what QZ Tray 2.1 verifies with, and what the backend signs
      // with. A mismatch refuses every print with nothing on screen wrong.
      expect(qz.security.setSignatureAlgorithm).toHaveBeenCalledWith('SHA512');
      expect(qz.security.setSignaturePromise).toHaveBeenCalledTimes(1);
    });
  });

  it('hands QZ the certificate it fetched', async () => {
    const qz = qzWithSecurity();
    await configureQzSigning(apiWith(), qz);

    const promise = qz.security.setCertificatePromise.mock.calls[0]?.[0] as (
      resolve: (v: string) => void,
    ) => void;
    const resolve = vi.fn();
    promise(resolve);

    expect(resolve).toHaveBeenCalledWith(expect.stringContaining('BEGIN CERTIFICATE'));
  });

  it('signs through the API, so the private key is never in this bundle', async () => {
    const api = apiWith();
    const qz = qzWithSecurity();
    await configureQzSigning(api, qz);

    const factory = qz.security.setSignaturePromise.mock.calls[0]?.[0] as (
      toSign: string,
    ) => (resolve: (v: string) => void, reject: (e?: unknown) => void) => void;
    const resolve = vi.fn();
    await new Promise<void>((done, fail) => {
      factory('{"call":"print"}')(
        (value) => {
          resolve(value);
          done();
        },
        (e) => fail(e),
      );
    });

    expect(api.qzSign).toHaveBeenCalledWith('{"call":"print"}');
    expect(resolve).toHaveBeenCalledWith('c2lnbmF0dXJl');
  });

  it('rejects the promise when signing fails rather than resolving with nothing', async () => {
    // QZ treats a request claiming a signature it cannot verify as a failure.
    // A print that fails loudly beats one that hangs at the counter.
    const api = apiWith({ qzSign: vi.fn().mockRejectedValue(new Error('503')) });
    const qz = qzWithSecurity();
    await configureQzSigning(api, qz);

    const factory = qz.security.setSignaturePromise.mock.calls[0]?.[0] as (
      toSign: string,
    ) => (resolve: (v: string) => void, reject: (e?: unknown) => void) => void;

    await expect(
      new Promise((res, rej) => {
        factory('x')(res as (v: string) => void, rej);
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('keeps printing when no certificate is configured', async () => {
    // The unsigned state is a working one: the branch prints, with the prompt.
    // Printing that stopped until a certificate was bought would hold a shop's
    // service hostage to a purchase order.
    const qz = qzWithSecurity();
    const api = apiWith({ qzCertificate: vi.fn().mockRejectedValue(new Error('503')) });

    const result = await configureQzSigning(api, qz);

    expect(result.signing).toBe(false);
    expect(qz.security.setCertificatePromise).not.toHaveBeenCalled();
  });

  it('installs once, however many prints follow', async () => {
    // Registering the promises twice is a way to end up with two of them.
    const api = apiWith();
    const qz = qzWithSecurity();

    await configureQzSigning(api, qz);
    await configureQzSigning(api, qz);
    await configureQzSigning(api, qz);

    expect(api.qzCertificate).toHaveBeenCalledTimes(1);
    expect(qz.security.setCertificatePromise).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a QZ client with no security API', async () => {
    const result = await configureQzSigning(apiWith(), {} as unknown as QzApi);

    expect(result.signing).toBe(false);
  });
});
