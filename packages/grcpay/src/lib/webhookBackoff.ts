import { config } from '../config';

/**
 * Exponential backoff for webhook delivery retries. Same shape as
 * refundBackoff (WEBHOOK_RETRY_BASE_DELAY * 2^(attempts-1)), but
 * returns the absolute next-attempt timestamp rather than a
 * "can I retry now?" boolean.
 *
 * Why absolute (vs refundBackoff's updated_at-relative gate): a
 * delivery row's updated_at is not a safe reference the way a wallet's
 * is. refundBackoff can lean on "nothing mutates a wallet between
 * failed attempts"; deliveries have no such invariant. Persisting an
 * explicit next_attempt_at makes the dispatcher's claim query a plain
 * `next_attempt_at <= now()` with no ambiguity.
 *
 * Jitter: ±25% randomised per call so a downed receiver doesn't get
 * retry-stormed by every wallet pointing at it firing at the same
 * second. The base shape (30s, 1m, 2m, 4m, 8m) is preserved on
 * average; individual deliveries spread out.
 *
 * With the default 30s base: ~30s, ~1m, ~2m, ~4m, ~8m — ~16 min of
 * retry budget across WEBHOOK_MAX_ATTEMPTS before the row is
 * dead-lettered.
 *
 * `attempts` is the number of attempts ALREADY made (>=1 when a
 * failure just occurred). attempts<=0 schedules immediately.
 */
export function nextWebhookAttemptAt(
  attempts: number,
  now: number = Date.now(),
): string {
  if (attempts <= 0) {
    return new Date(now).toISOString();
  }
  const base = config.WEBHOOK_RETRY_BASE_DELAY * (2 ** (attempts - 1));
  const jitter = 0.75 + Math.random() * 0.5;
  const delaySeconds = base * jitter;
  return new Date(now + delaySeconds * 1000).toISOString();
}
