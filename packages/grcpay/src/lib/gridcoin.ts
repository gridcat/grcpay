/* eslint-disable max-classes-per-file */
import { GridcoinRPC } from 'gridcoin-rpc';
import { config } from '../config';
import { log } from './log';
import { withTimeout } from './withTimeout';

const wait = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

// Default RPC timeout. gridcoin-rpc wraps Node's http.request with no
// timeout option, so a misbehaving wallet daemon can wedge a call
// indefinitely — which in turn wedges the job loop, since
// walletFundedProcessorService awaits every RPC inline. 30s is long
// enough to accommodate slow sendToAddress signing on a busy chain but
// short enough that one stuck call can't keep the processor frozen
// across the full JOBS_INTERVAL cadence.
const RPC_TIMEOUT_MS = 30_000;

// Circuit breaker for the Gridcoin RPC client. Wraps the per-call
// timeout above with a failure-rate gate so grcpay stops hammering a
// daemon that's clearly in trouble, giving it room to recover.
//
// States:
//   closed    — normal. Requests go through. Failures increment a
//               counter; successes reset it.
//   open      — fast-fail. Every request is rejected immediately with
//               a BreakerOpenError. A cooldown timer runs in the
//               background; when it elapses we transition to half-open.
//   half-open — probe. One request is allowed through. If it succeeds
//               the breaker closes; if it fails (or times out) we go
//               straight back to open with a fresh cooldown.
//
// Disabled entirely by setting RPC_BREAKER_THRESHOLD=0 in the env —
// useful for dev or when troubleshooting an unrelated issue.
type BreakerState = 'closed' | 'open' | 'half-open';

class BreakerOpenError extends Error {
  public readonly code = 'RPC_BREAKER_OPEN';

  constructor(method: string, openedForMs: number) {
    super(
      `Gridcoin RPC breaker is open after ${config.RPC_BREAKER_THRESHOLD} consecutive failures; `
      + `rejecting ${method} (cooldown resumes in ~${Math.max(0, Math.ceil(openedForMs / 1000))}s)`,
    );
  }
}

class RpcBreaker {
  private state: BreakerState = 'closed';

  private consecutiveFailures = 0;

  private openedAt = 0;

  public isDisabled(): boolean {
    return config.RPC_BREAKER_THRESHOLD <= 0;
  }

  /** Called before a request is dispatched. Throws if the breaker is open. */
  public precheck(method: string): void {
    if (this.isDisabled()) return;
    if (this.state === 'open') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < config.RPC_BREAKER_COOLDOWN_MS) {
        throw new BreakerOpenError(method, config.RPC_BREAKER_COOLDOWN_MS - elapsed);
      }
      // Cooldown elapsed — let exactly one probe through.
      this.state = 'half-open';
      log.info('Gridcoin RPC breaker transitioning from open → half-open (probing)');
    }
  }

  public recordSuccess(): void {
    if (this.isDisabled()) return;
    if (this.state !== 'closed') {
      log.info(`Gridcoin RPC breaker transitioning from ${this.state} → closed`);
    }
    this.state = 'closed';
    this.consecutiveFailures = 0;
  }

  public recordFailure(): void {
    if (this.isDisabled()) return;
    // A failed probe in half-open → straight back to open with a
    // fresh cooldown, don't wait for threshold to accumulate again.
    if (this.state === 'half-open') {
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= config.RPC_BREAKER_THRESHOLD) {
      this.trip();
    }
  }

  private trip(): void {
    if (this.state !== 'open') {
      log.warn(
        `Gridcoin RPC breaker tripping open after ${this.consecutiveFailures} failures; `
        + `cooldown ${config.RPC_BREAKER_COOLDOWN_MS}ms`,
      );
    }
    this.state = 'open';
    this.openedAt = Date.now();
  }
}

const breaker = new RpcBreaker();

const rawRpc = new GridcoinRPC({
  port: config.GRC_RPC_PORT,
  host: config.GRC_RPC_HOST,
  username: config.GRC_RPC_USER,
  password: config.GRC_RPC_PASSWORD,
});

// Proxy the client so every method call goes through the timeout +
// breaker layers. Callers just `await rpc.getNewAddress()` as before;
// the resilience behaviour is invisible to them except in the error
// types they might see (`BreakerOpenError`, `"... timed out after Nms"`).
export const rpc = new Proxy(rawRpc, {
  get(target, prop: string | symbol, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function') return value;
    return function wrapped(this: unknown, ...args: unknown[]) {
      const method = String(prop);
      try {
        breaker.precheck(method);
      } catch (e) {
        return Promise.reject(e);
      }
      const result = value.apply(this === receiver ? target : this, args);
      if (!result || typeof (result as Promise<unknown>).then !== 'function') {
        return result;
      }
      return withTimeout(result as Promise<unknown>, RPC_TIMEOUT_MS, `Gridcoin RPC ${method}`)
        .then((ok) => {
          breaker.recordSuccess();
          return ok;
        })
        .catch((err) => {
          breaker.recordFailure();
          throw err;
        });
    };
  },
}) as typeof rawRpc;

export async function connect(): Promise<boolean> {
  try {
    await rpc.getWalletInfo();
    return true;
  } catch (err) {
    log.warn('Connection error');
    await wait(5000);
    return false;
  }
}
