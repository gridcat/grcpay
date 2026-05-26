/**
 * Typed error class for the timeout branch. Callers that need to
 * distinguish "broadcast didn't happen, safe to retry" from "broadcast
 * may have committed before the RPC reply landed" can `instanceof`-check
 * for this class — message-string sniffing is fragile across i18n /
 * label changes.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a Promise against a timeout. If `p` settles within `ms` we return
 * its result; otherwise we reject with a labelled `TimeoutError` so the
 * call site is identifiable in logs AND in code (the class is exported
 * for catch-side `instanceof` checks). There is no behavioural coupling
 * to the RPC subsystem or breaker, so callers with independent failure
 * models (RPC, webhook delivery) can share this helper safely.
 *
 * Pass an `AbortController` when `p` is built from a cancellable
 * primitive (axios `signal`, fetch `signal`, native `AbortSignal`). On
 * timeout we call `controller.abort()` BEFORE rejecting, so the
 * underlying socket is torn down instead of dangling — without this,
 * a slow-loris receiver that dribbles bytes can keep the connection
 * open past the timeout, leaking memory/fds across retries.
 *
 * `finally(clearTimeout)` runs on both race outcomes, so the underlying
 * timer is always cleared and never leaks.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  controller?: AbortController,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        if (controller) controller.abort();
        reject(new TimeoutError(`${label} timed out after ${ms}ms`));
      },
      ms,
    );
  });
  // When the timer wins the race and we abort `p`, `p` will reject
  // shortly after with a cancellation error (axios's CanceledError,
  // fetch's AbortError). Promise.race only forwards the first
  // settlement, so `p`'s late rejection would otherwise be an
  // unhandled promise rejection — log spam at best, a process crash
  // under --unhandled-rejections=strict at worst. Attaching a no-op
  // catch silences it without affecting the race winner.
  // eslint-disable-next-line no-empty-function
  p.catch(() => {});
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
