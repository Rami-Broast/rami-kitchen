/**
 * The QZ Tray client, and the slice of its API this app depends on.
 *
 * Kept in its own module so the printer engine and the discovery layer share
 * one client and one type, and so a test can substitute a fake by passing it in
 * rather than by monkey-patching a global.
 */
import qzTray from 'qz-tray';

/**
 * The documented QZ Tray surface we use. Narrower than the real client on
 * purpose: anything not declared here is not depended on, so an upgrade cannot
 * quietly break a call we forgot we made.
 */
export interface QzApi {
  websocket: { isActive(): boolean; connect(): Promise<void> };
  printers: { find(): Promise<string[]>; getDefault(): Promise<string | null> };
  configs: { create(printer: string, options?: Record<string, unknown>): unknown };
  print(config: unknown, data: unknown[]): Promise<void>;
}

/**
 * Resolves the QZ Tray JavaScript client.
 *
 * Prefers a `window.qz` if the counter machine injects its own build (some
 * sites serve the client from the QZ install so it can be patched without
 * rebuilding this app); otherwise uses the bundled `qz-tray` dependency.
 *
 * The bundled import is what makes the real print path work at all. It
 * previously read `globalThis.qz` only, and **nothing in this app ever loaded
 * that client** — no script tag, no dependency — so every real print failed
 * with "QZ Tray is not running" even on a machine where it was. Installing the
 * QZ Tray *desktop application* does not create `window.qz`; the browser needs
 * the JS client too. Those are two separate installs.
 */
export function resolveQz(): QzApi {
  return (globalThis as { qz?: QzApi }).qz ?? (qzTray as unknown as QzApi);
}
