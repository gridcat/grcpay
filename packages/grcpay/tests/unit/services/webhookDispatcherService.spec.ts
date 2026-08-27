import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../../src/lib/ssrfGuard', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/ssrfGuard')>(
    '../../../src/lib/ssrfGuard',
  );
  return { ...actual, assertSafeWebhookUrl: vi.fn() };
});

import axios from 'axios';
// eslint-disable-next-line import/first
import { createHmac } from 'crypto';
// eslint-disable-next-line import/first
import { WebhookDispatcherServiceClass } from '../../../src/services/webhook/webhookDispatcherService';
// eslint-disable-next-line import/first
import { assertSafeWebhookUrl, WebhookUrlError } from '../../../src/lib/ssrfGuard';
// eslint-disable-next-line import/first
import { config } from '../../../src/config';
// eslint-disable-next-line import/first
import { db, now } from '../../../src/lib/db';
// eslint-disable-next-line import/first
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockedPost = (axios as unknown as { post: Mock }).post;
const mockedAssert = assertSafeWebhookUrl as Mock;

const SECRET = 'top-secret';

let walletSeq = 0;

async function seed(opts: {
  attempts?: number;
  nextAttemptAt?: string;
  payload?: string;
} = {}): Promise<{ id: bigint; eventUuid: string; payload: string }> {
  walletSeq += 1;
  const wallet = await insertWallet({
    address: `S${String(walletSeq).padStart(33, '0')}`,
  });
  const ts = now();
  await db.insertInto('wallet_webhooks').values({
    wallet_id: wallet.id,
    url: 'https://shop.example/hook',
    secret: SECRET,
    created_at: ts,
    updated_at: ts,
  }).execute();
  const eventUuid = `evt-${Math.random().toString(36).slice(2)}`;
  const payload = opts.payload ?? JSON.stringify({ id: eventUuid, newStatus: 'funded' });
  const inserted = await db.insertInto('webhook_deliveries').values({
    wallet_id: wallet.id,
    event_uuid: eventUuid,
    old_status: 'confirming',
    new_status: 'funded',
    payload,
    status: 'pending',
    attempts: BigInt(opts.attempts ?? 0),
    next_attempt_at: opts.nextAttemptAt ?? ts,
    last_response_code: null,
    last_error: null,
    created_at: ts,
    updated_at: ts,
  }).returningAll().executeTakeFirstOrThrow();
  return { id: inserted.id, eventUuid, payload };
}

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherServiceClass;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    service = new WebhookDispatcherServiceClass();
    mockedAssert.mockResolvedValue({
      url: new URL('https://shop.example/hook'),
      pinnedIp: '93.184.216.34',
      family: 4,
    });
  });

  it('marks a delivery delivered on HTTP 2xx', async () => {
    const { id } = await seed();
    mockedPost.mockResolvedValue({ status: 200 });

    await service.dispatchDue();

    const row = await db.selectFrom('webhook_deliveries').selectAll()
      .where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('delivered');
    expect(Number(row.last_response_code)).toBe(200);
    expect(row.attempts).toBe(BigInt(1));
  });

  it('signs the exact body with HMAC-SHA256 over "<ts>.<event_id>.<attempt>.<body>"', async () => {
    const { payload } = await seed();
    mockedPost.mockResolvedValue({ status: 200 });

    await service.dispatchDue();

    const [, sentBody, cfg] = mockedPost.mock.calls[0];
    expect(sentBody).toBe(payload);
    const ts = Number(cfg.headers['X-Grcpay-Timestamp']);
    const eventId = cfg.headers['X-Grcpay-Event-Id'];
    const attempt = Number(cfg.headers['X-Grcpay-Attempt']);
    const signedInput = `${ts}.${eventId}.${attempt}.${payload}`;
    const expected = `sha256=${createHmac('sha256', SECRET).update(signedInput).digest('hex')}`;
    expect(cfg.headers['X-Grcpay-Signature']).toBe(expected);
    expect(cfg.maxRedirects).toBe(0);
    expect(cfg.httpsAgent).toBeDefined();
  });

  it('retries with backoff on a non-2xx response', async () => {
    const { id } = await seed();
    mockedPost.mockResolvedValue({ status: 500 });
    const before = Date.now();

    await service.dispatchDue();

    const row = await db.selectFrom('webhook_deliveries').selectAll()
      .where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(BigInt(1));
    expect(Number(row.last_response_code)).toBe(500);
    const delayMs = new Date(row.next_attempt_at).getTime() - before;
    // ~ WEBHOOK_RETRY_BASE_DELAY seconds out (1 attempt made). The
    // backoff applies ±25% jitter to break retry storms, so allow the
    // full jittered window plus a small slack for clock drift between
    // `before` and the timestamp recorded inside dispatchDue.
    expect(delayMs).toBeGreaterThanOrEqual((config.WEBHOOK_RETRY_BASE_DELAY * 0.75 - 2) * 1000);
    expect(delayMs).toBeLessThanOrEqual((config.WEBHOOK_RETRY_BASE_DELAY * 1.25 + 5) * 1000);
  });

  it('dead-letters after WEBHOOK_MAX_ATTEMPTS', async () => {
    const { id } = await seed({ attempts: config.WEBHOOK_MAX_ATTEMPTS - 1 });
    mockedPost.mockResolvedValue({ status: 503 });

    await service.dispatchDue();

    const row = await db.selectFrom('webhook_deliveries').selectAll()
      .where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(BigInt(config.WEBHOOK_MAX_ATTEMPTS));
  });

  it('does not claim rows whose next_attempt_at is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { id } = await seed({ nextAttemptAt: future });
    mockedPost.mockResolvedValue({ status: 200 });

    await service.dispatchDue();

    const row = await db.selectFrom('webhook_deliveries').selectAll()
      .where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('treats a delivery-time SSRF rejection as a retryable failure', async () => {
    const { id } = await seed();
    mockedAssert.mockRejectedValue(new WebhookUrlError('resolves to 10.0.0.1 (private)'));

    await service.dispatchDue();

    const row = await db.selectFrom('webhook_deliveries').selectAll()
      .where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(BigInt(1));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(row.last_error).toMatch(/private/);
  });

  it('processes due rows oldest-first (per-wallet FIFO)', async () => {
    const a = await seed();
    const b = await seed();
    mockedPost.mockResolvedValue({ status: 200 });

    await service.dispatchDue();

    const order = mockedPost.mock.calls.map((c) => c[2].headers['X-Grcpay-Event-Id']);
    expect(order).toEqual([a.eventUuid, b.eventUuid]);
  });
});
