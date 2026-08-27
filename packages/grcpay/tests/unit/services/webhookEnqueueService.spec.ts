import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebhookEnqueueServiceClass,
  isWebhookWorthy,
} from '../../../src/services/webhook/webhookEnqueueService';
import { createMockEventEmitter } from '../../helpers/mocks';
import { db, now } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';
import { log } from '../../../src/lib/log';

async function addWebhook(walletId: bigint, url = 'https://shop.example/hook'): Promise<void> {
  const ts = now();
  await db.insertInto('wallet_webhooks').values({
    wallet_id: walletId,
    url,
    secret: 'secret-key',
    created_at: ts,
    updated_at: ts,
  }).execute();
}

describe('isWebhookWorthy', () => {
  it('is true for forward + terminal transitions', () => {
    expect(isWebhookWorthy('new', 'confirming')).toBe(true);
    expect(isWebhookWorthy('confirming', 'funded')).toBe(true);
    expect(isWebhookWorthy('funded', 'processed')).toBe(true);
    expect(isWebhookWorthy('new', 'expired')).toBe(true);
    expect(isWebhookWorthy('expired', 'refunded')).toBe(true);
    expect(isWebhookWorthy('expired', 'norefund')).toBe(true);
    expect(isWebhookWorthy('funded', 'error')).toBe(true);
  });

  it('is false for the creation emit and flap-backs', () => {
    expect(isWebhookWorthy(undefined, 'new')).toBe(false);
    expect(isWebhookWorthy('confirming', 'new')).toBe(false);
    expect(isWebhookWorthy('funded', 'funded')).toBe(false);
    expect(isWebhookWorthy('new', undefined)).toBe(false);
  });
});

describe('WebhookEnqueueService', () => {
  let service: WebhookEnqueueServiceClass;
  let mockEmitter: ReturnType<typeof createMockEventEmitter>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    mockEmitter = createMockEventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new WebhookEnqueueServiceClass(mockEmitter as any);
    service.registerEventListener();
  });

  it('enqueues a delivery for a worthy transition on an opted-in wallet', async () => {
    const wallet = await insertWallet({ amount_recieved: BigInt(5) });
    await addWebhook(wallet.id);

    mockEmitter.emit('log', {
      walletId: Number(wallet.id),
      action: 'status',
      oldStatus: 'new',
      newStatus: 'confirming',
    });
    await new Promise((r) => setTimeout(r, 30));

    const rows = await db.selectFrom('webhook_deliveries').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wallet_id: wallet.id,
      new_status: 'confirming',
      old_status: 'new',
      status: 'pending',
      attempts: BigInt(0),
    });
    const payload = JSON.parse(rows[0].payload);
    expect(payload).toMatchObject({
      type: 'wallet.status',
      walletAddress: wallet.address,
      newStatus: 'confirming',
    });
  });

  it('does nothing when the wallet has no webhook config', async () => {
    const wallet = await insertWallet();
    mockEmitter.emit('log', {
      walletId: Number(wallet.id),
      action: 'status',
      oldStatus: 'new',
      newStatus: 'funded',
    });
    await new Promise((r) => setTimeout(r, 30));
    const rows = await db.selectFrom('webhook_deliveries').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('ignores non-status actions', async () => {
    const wallet = await insertWallet();
    await addWebhook(wallet.id);
    mockEmitter.emit('log', {
      walletId: Number(wallet.id),
      action: 'amount_required',
      newStatus: '1000',
    });
    await new Promise((r) => setTimeout(r, 30));
    const rows = await db.selectFrom('webhook_deliveries').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('is idempotent: a duplicate transition enqueues exactly once and never throws', async () => {
    const wallet = await insertWallet();
    await addWebhook(wallet.id);
    const errorSpy = vi.spyOn(log, 'error');

    for (let i = 0; i < 3; i += 1) {
      mockEmitter.emit('log', {
        walletId: Number(wallet.id),
        action: 'status',
        oldStatus: 'confirming',
        newStatus: 'funded',
      });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));
    }

    const rows = await db.selectFrom('webhook_deliveries').selectAll().execute();
    expect(rows).toHaveLength(1);
    // The dup path is a silent no-op, not an error.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
