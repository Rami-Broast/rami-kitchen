/**
 * Signing QZ Tray's requests, so the counter is never asked to allow printing.
 *
 * QZ shows an "untrusted website" dialog once per session for a page it cannot
 * verify. On a counter terminal that nobody reloads that is still every
 * morning, mid-service, in front of somebody who does not know what the dialog
 * is asking — and the first order of the day waits behind it.
 *
 * Two promises remove it (QZ's documented mechanism): one hands over the
 * **public certificate**, the other returns a signature for each request. Both
 * go through this platform's API, because **the private key must never be in
 * this app** — the POS is a static bundle served to every branch, and anything
 * in it can be read from a browser's source tab.
 *
 * Three rules:
 *
 *  - **It is installed before `connect`, once.** QZ reads the certificate when
 *    the socket opens, so installing it afterwards changes nothing until the
 *    next reconnect — and a re-install mid-session is how a promise ends up
 *    registered twice.
 *  - **It never blocks printing.** No certificate configured, or an API that
 *    cannot be reached, means the promises are simply not installed: QZ prompts
 *    and the branch prints. Printing that stopped until a certificate was
 *    bought would hold a shop's service hostage to a purchase order.
 *  - **A rejected signature rejects the promise**, rather than resolving with
 *    something empty. QZ treats an unsigned-but-claimed-signed request as a
 *    failure, and a print that fails loudly is better than one that hangs.
 */
import { Api } from '../api/endpoints';
import { QzApi, resolveQz } from './qz-client';

interface QzSecurityApi {
  security?: {
    setCertificatePromise(promise: (resolve: (v: string) => void, reject: (e?: unknown) => void) => void): void;
    setSignatureAlgorithm(algorithm: string): void;
    setSignaturePromise(
      promise: (toSign: string) => (resolve: (v: string) => void, reject: (e?: unknown) => void) => void,
    ): void;
  };
}

let installed = false;
let certificate: string | null = null;

/** Test seam — a new terminal session starts with nothing installed. */
export function resetQzSigning(): void {
  installed = false;
  certificate = null;
}

/**
 * Installs the signing promises if this platform has a certificate.
 *
 * Returns whether prints will be silent, so the setup screen can say which of
 * the two states a branch is in rather than leaving it to be discovered from a
 * dialog during service.
 */
export async function configureQzSigning(
  api: Api,
  qz: QzApi = resolveQz(),
): Promise<{ signing: boolean }> {
  if (installed) {
    return { signing: certificate !== null };
  }

  const security = (qz as unknown as QzSecurityApi).security;
  if (!security) {
    // An older QZ client with no security API: nothing to install, and the
    // branch prints with the prompt.
    installed = true;
    return { signing: false };
  }

  try {
    certificate = await api.qzCertificate();
  } catch {
    // Not configured, or the API is unreachable from this counter. Either way
    // the printer is what matters and it still works.
    installed = true;
    certificate = null;
    return { signing: false };
  }

  const pem = certificate;
  security.setCertificatePromise((resolve) => {
    resolve(pem);
  });
  // SHA-512 is what QZ Tray 2.1 expects; the backend signs with the same.
  security.setSignatureAlgorithm('SHA512');
  security.setSignaturePromise((toSign) => (resolve, reject) => {
    api
      .qzSign(toSign)
      .then(resolve)
      .catch((e: unknown) => reject(e));
  });

  installed = true;
  return { signing: true };
}
