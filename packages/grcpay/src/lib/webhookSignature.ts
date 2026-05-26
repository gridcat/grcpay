import { createHmac } from 'crypto';

// Header names grcpay sends with every webhook POST. Documented for
// integrators in the developers/Webhooks docs chapter.
export const WEBHOOK_EVENT_ID_HEADER = 'X-Grcpay-Event-Id';
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Grcpay-Timestamp';
export const WEBHOOK_ATTEMPT_HEADER = 'X-Grcpay-Attempt';
export const WEBHOOK_SIGNATURE_HEADER = 'X-Grcpay-Signature';

/**
 * HMAC-SHA256 over the exact string
 * `"<timestamp>.<event_id>.<attempt>.<body>"`, hex encoded. Every
 * field a receiver might dedupe / route off is covered by the MAC:
 *
 *   * `timestamp` defeats replay of captured body+sig with a fresh
 *     clock (receiver verifies the sig AND that the timestamp is
 *     within a tolerance window — we recommend 300s in the docs).
 *   * `event_id` is the value of X-Grcpay-Event-Id; binding it stops
 *     header tampering on a captured delivery from defeating a
 *     receiver's idempotency dedup.
 *   * `attempt` is the value of X-Grcpay-Attempt; binding it lets
 *     receivers tell genuine retries from header forgery if they
 *     ever inspect that header (e.g. log-once-per-attempt).
 *
 * `body` must be the EXACT bytes that go on the wire. Callers must
 * serialize once, sign that string, and send that same string —
 * re-stringifying for the wire would risk a key-order/whitespace
 * mismatch that breaks verification.
 */
export function webhookSignature(
  secret: string,
  timestamp: number,
  eventId: string,
  attempt: number,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${eventId}.${attempt}.${body}`)
    .digest('hex');
}

/** The value for the X-Grcpay-Signature header: `sha256=<hex>`. */
export function webhookSignatureHeader(
  secret: string,
  timestamp: number,
  eventId: string,
  attempt: number,
  body: string,
): string {
  return `sha256=${webhookSignature(secret, timestamp, eventId, attempt, body)}`;
}
