import { config } from '../config';

/**
 * Exponential backoff gate for refund / forward retries. Given how many
 * times the operation has already failed and when the wallet was last
 * touched, returns whether enough time has elapsed for the next attempt.
 *
 * Delay = REFUND_RETRY_BASE_DELAY * 2^(attempts-1), CAPPED at
 * RESCUE_MAX_INTERVAL. With the default 30s base the intervals are 30s,
 * 1m, 2m, 4m — ~7.5 min before MAX_REFUND_ATTEMPTS, long enough for an
 * operator to notice a "wallet locked" alert and actually unlock the
 * daemon.
 *
 * The cap exists because `attempts` is NOT bounded in every caller. A
 * wallet that expireWallets rescues out of `error` keeps its burned
 * counter, so each rescue cycle pushes it higher; uncapped, the doubling
 * reaches days and then years, and a wallet holding customer money that
 * was neither forwarded nor refunded is abandoned in all but name. The
 * cap turns that tail into a steady retry at RESCUE_MAX_INTERVAL. It
 * never changes the bounded callers: at the configured ceilings
 * (MAX_REFUND_ATTEMPTS, FORWARD_RETRY_MAX_ATTEMPTS) the computed delay
 * stays well under the cap, so those schedules are untouched.
 *
 * `updated_at` is a safe reference because nothing else mutates a
 * wallet between failed attempts: the balance updater only touches
 * `new`, and each processor operates on a distinct status.
 */
export function canRetryRefund(
  attempts: number,
  updatedAt: Date,
  now: number = Date.now(),
): boolean {
  if (attempts <= 0) return true;
  const uncapped = config.REFUND_RETRY_BASE_DELAY * (2 ** (attempts - 1));
  const requiredSeconds = Math.min(uncapped, config.RESCUE_MAX_INTERVAL);
  const elapsedSeconds = (now - updatedAt.getTime()) / 1000;
  return elapsedSeconds >= requiredSeconds;
}
