/**
 * A key that makes one counter order safe to retry.
 *
 * Sent as `Idempotency-Key`; the backend places the order once per key and
 * replays the result afterwards. The key belongs to the *attempt*, not the
 * request — a fresh key on every send makes every retry look like a new order,
 * which is the duplicate it exists to prevent.
 */
export function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID;

  if (typeof uuid === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const block = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');

  return `${block(8)}-${block(4)}-${block(4)}-${block(4)}-${block(12)}`;
}
