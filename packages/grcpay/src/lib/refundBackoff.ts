import { config } from '../config';

/**
 * Exponential backoff gate for refund retries. Given how many times
 * the refund has already failed and when the wallet was last touched,
 * returns whether enough time has elapsed for the next attempt.
 *
 * Delay = REFUND_RETRY_BASE_DELAY * 2^(attempts-1). With the default
 * 30s base the intervals are 30s, 1m, 2m, 4m — ~7.5 min total budget
 * before MAX_REFUND_ATTEMPTS, long enough for an operator to notice
 * a "wallet locked" alert and actually unlock the daemon.
 *
 * `updated_at` is a safe reference because nothing else mutates a
 * wallet between failed refund attempts: the balance updater only
 * touches `new`, and each processor operates on a distinct status.
 */
export function canRetryRefund(
  attempts: number,
  updatedAt: Date,
  now: number = Date.now(),
): boolean {
  if (attempts <= 0) return true;
  const requiredSeconds = config.REFUND_RETRY_BASE_DELAY * (2 ** (attempts - 1));
  const elapsedSeconds = (now - updatedAt.getTime()) / 1000;
  return elapsedSeconds >= requiredSeconds;
}
