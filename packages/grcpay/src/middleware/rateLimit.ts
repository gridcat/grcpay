import HttpStatus from 'http-status-codes';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { ErrorModel } from '../models/Error';

/**
 * Per-IP sliding-window rate limiter. Keeps a list of request
 * timestamps per client IP and rejects with 429 once more than
 * `maxRequests` timestamps fall inside the trailing `windowMs`.
 * Stale IP buckets are swept on a background timer.
 *
 * `req.ip` respects Express's `trust proxy` setting, so when grcpay
 * runs behind nginx / a load balancer the limiter sees the real
 * client rather than the upstream proxy's address.
 */
export function createRateLimiter(windowMs: number, maxRequests: number) {
  const requests = new Map<string, number[]>();

  // `.unref()` so the timer doesn't pin the event loop (or Jest) open.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of requests) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, valid);
      }
    }
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (requests.get(ip) || []).filter((t) => t > windowStart);

    if (timestamps.length >= maxRequests) {
      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .send({
          errors: [
            new ErrorModel(
              HttpStatus.TOO_MANY_REQUESTS,
              'Too Many Requests',
              `Rate limit exceeded. Try again in ${Math.ceil(windowMs / 1000)} seconds.`,
            ),
          ],
        });
      return;
    }

    timestamps.push(now);
    requests.set(ip, timestamps);
    next();
  };
}

const ONE_MINUTE_MS = 60 * 1000;

/**
 * Ready-to-use limiters for the wallet routes. Each one is its own
 * independent bucket — hitting the limit on one endpoint does not
 * consume budget on another. All bucket sizes come from env-tunable
 * config keys with sane defaults; see `config.ts` for the rationale
 * behind each number.
 */
export const walletCreateRateLimiter = createRateLimiter(
  ONE_MINUTE_MS,
  config.RATE_LIMIT_WALLET_CREATE_PER_MIN,
);

export const walletReadRateLimiter = createRateLimiter(
  ONE_MINUTE_MS,
  config.RATE_LIMIT_WALLET_READ_PER_MIN,
);

export const walletDeleteRateLimiter = createRateLimiter(
  ONE_MINUTE_MS,
  config.RATE_LIMIT_WALLET_DELETE_PER_MIN,
);

export const qrRateLimiter = createRateLimiter(
  ONE_MINUTE_MS,
  config.RATE_LIMIT_QR_PER_MIN,
);

export const ratesRateLimiter = createRateLimiter(
  ONE_MINUTE_MS,
  config.RATE_LIMIT_RATES_PER_MIN,
);
