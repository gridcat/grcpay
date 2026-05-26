import { nextWebhookAttemptAt } from '../../../src/lib/webhookBackoff';
import { config } from '../../../src/config';

// Jitter is ±25% per call (0.75 .. 1.25 of base delay). Each delay
// expectation is asserted as a window rather than an exact value so a
// flaky Math.random doesn't flake the suite.
const JITTER_LOW = 0.75;
const JITTER_HIGH = 1.25;

function expectDelayWithJitter(
  attempts: number,
  now: number,
  expectedBaseSeconds: number,
): void {
  const t = Date.parse(nextWebhookAttemptAt(attempts, now));
  expect(t).toBeGreaterThanOrEqual(now + expectedBaseSeconds * JITTER_LOW * 1000);
  expect(t).toBeLessThanOrEqual(now + expectedBaseSeconds * JITTER_HIGH * 1000);
}

describe('webhookBackoff', () => {
  describe('nextWebhookAttemptAt', () => {
    const now = 10_000_000;
    const base = config.WEBHOOK_RETRY_BASE_DELAY; // 30 by default

    it('schedules immediately when no attempts have been made', () => {
      expect(nextWebhookAttemptAt(0, now)).toBe(new Date(now).toISOString());
    });

    it('waits one base delay (±25% jitter) after the first failed attempt', () => {
      expectDelayWithJitter(1, now, base);
    });

    it('doubles the delay (±25% jitter) each subsequent attempt', () => {
      expectDelayWithJitter(2, now, base * 2);
      expectDelayWithJitter(3, now, base * 4);
      expectDelayWithJitter(4, now, base * 8);
    });

    it('jitter actually varies — successive calls at attempts=4 differ', () => {
      const a = nextWebhookAttemptAt(4, now);
      const b = nextWebhookAttemptAt(4, now);
      const c = nextWebhookAttemptAt(4, now);
      // With three samples in a continuous range there is essentially
      // zero chance of all three colliding (one in ~Number.MAX_SAFE^2);
      // any collision implies the jitter is constant and the retry
      // storm we added jitter to prevent is back.
      expect(new Set([a, b, c]).size).toBeGreaterThan(1);
    });
  });
});
