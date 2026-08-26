import { describe, it, expect } from 'vitest';
import { canRetryRefund } from '../../../src/lib/refundBackoff';
import { config } from '../../../src/config';

describe('refundBackoff', () => {
  describe('canRetryRefund', () => {
    it('allows retries when attempts is 0', () => {
      expect(canRetryRefund(0, new Date(), Date.now())).toBe(true);
    });

    it('blocks retries until the required delay has elapsed', () => {
      const now = 10_000_000;
      const updatedAt = new Date(now - 5_000); // 5s ago
      // 1 attempt → needs base delay (30s by default)
      expect(canRetryRefund(1, updatedAt, now)).toBe(false);
    });

    it('allows retries once the required delay has elapsed', () => {
      const now = 10_000_000;
      const updatedAt = new Date(now - (config.REFUND_RETRY_BASE_DELAY * 1000 + 1000));
      expect(canRetryRefund(1, updatedAt, now)).toBe(true);
    });

    it('uses exponentially longer delays as attempts climb', () => {
      const now = 10_000_000;
      const base = config.REFUND_RETRY_BASE_DELAY;
      // attempts=3 needs 4 * base seconds.
      const justUnder = new Date(now - (base * 4 * 1000 - 500));
      const justOver = new Date(now - (base * 4 * 1000 + 500));
      expect(canRetryRefund(3, justUnder, now)).toBe(false);
      expect(canRetryRefund(3, justOver, now)).toBe(true);
    });
  });

  describe('capped backoff for budget-burned wallets', () => {
    it('rescues immediately when no refund attempt was ever made', () => {
      // Funded-processor flips land here with attempts=0.
      expect(canRetryRefund(0, new Date(), Date.now())).toBe(true);
    });

    it('holds off a budget-burned row until its backoff window elapses', () => {
      const now = 10_000_000;
      expect(canRetryRefund(5, new Date(now - 1_000), now)).toBe(false);
    });

    it('DOES eventually rescue a budget-burned row — funds are never abandoned', () => {
      // The regression this exists for: requiring refund_attempts = 0
      // meant a row that burned its budget was never revisited, so
      // customer money that was neither forwarded nor refunded sat
      // there for ever.
      const now = 10_000_000;
      const longAgo = new Date(now - (config.RESCUE_MAX_INTERVAL * 1000 + 1000));
      expect(canRetryRefund(5, longAgo, now)).toBe(true);
    });

    it('caps the interval so it cannot grow to effectively-never', () => {
      const now = 10_000_000;
      // 40 attempts uncapped would be 30 * 2^39 seconds — centuries.
      const justOverCap = new Date(now - (config.RESCUE_MAX_INTERVAL * 1000 + 1000));
      expect(canRetryRefund(40, justOverCap, now)).toBe(true);
      const justUnderCap = new Date(now - (config.RESCUE_MAX_INTERVAL * 1000 - 5_000));
      expect(canRetryRefund(40, justUnderCap, now)).toBe(false);
    });
  });
});
