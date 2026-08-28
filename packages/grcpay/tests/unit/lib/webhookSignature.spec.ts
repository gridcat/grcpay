import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import {
  webhookSignature,
  webhookSignatureHeader,
} from '../../../src/lib/webhookSignature';

describe('webhookSignature', () => {
  const secret = 'a-very-secret-key';
  const body = '{"id":"evt_1","newStatus":"funded"}';
  const ts = 1_700_000_000;
  const eventId = 'evt_1';
  const attempt = 1;

  function expected(s: string, t: number, e: string, a: number, b: string): string {
    return createHmac('sha256', s).update(`${t}.${e}.${a}.${b}`).digest('hex');
  }

  it('is HMAC-SHA256 over "<timestamp>.<event_id>.<attempt>.<body>"', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).toBe(
      expected(secret, ts, eventId, attempt, body),
    );
  });

  it('is deterministic for the same inputs', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).toBe(
      webhookSignature(secret, ts, eventId, attempt, body),
    );
  });

  it('changes when the timestamp changes (replay binding)', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).not.toBe(
      webhookSignature(secret, ts + 1, eventId, attempt, body),
    );
  });

  it('changes when the event_id changes (header-tamper binding)', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).not.toBe(
      webhookSignature(secret, ts, 'evt_other', attempt, body),
    );
  });

  it('changes when the attempt changes', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).not.toBe(
      webhookSignature(secret, ts, eventId, attempt + 1, body),
    );
  });

  it('changes when the body changes', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).not.toBe(
      webhookSignature(secret, ts, eventId, attempt, `${body} `),
    );
  });

  it('changes when the secret changes', () => {
    expect(webhookSignature(secret, ts, eventId, attempt, body)).not.toBe(
      webhookSignature('other', ts, eventId, attempt, body),
    );
  });

  it('header is prefixed with sha256=', () => {
    expect(webhookSignatureHeader(secret, ts, eventId, attempt, body)).toBe(
      `sha256=${expected(secret, ts, eventId, attempt, body)}`,
    );
  });
});
