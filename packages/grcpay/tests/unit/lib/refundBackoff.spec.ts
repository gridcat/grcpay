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
});
