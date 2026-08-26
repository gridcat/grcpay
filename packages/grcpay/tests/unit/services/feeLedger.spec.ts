import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { FeeLedgerServiceClass } from '../../../src/services/wallet/feeLedger';
import { OutgoingTxKind } from '../../../src/lib/database';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll } from '../../helpers/db';

type MockRpc = ReturnType<typeof createMockRpc>;

async function readRows() {
  return db.selectFrom('outgoing_txs').selectAll().orderBy('id', 'asc').execute();
}

describe('FeeLedgerService', () => {
  let service: FeeLedgerServiceClass;
  let mockRpc: MockRpc;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new FeeLedgerServiceClass(mockRpc as never);
  });

  it('stores the daemon\'s negative fee as a positive fee_halford', async () => {
    // createMockRpc defaults getTransaction → { fee: -0.001 }: the
    // daemon pushes the fee unnegated, so it is negative for sends.
    await service.recordBroadcast(7, 'txid_fee_1', OutgoingTxKind.forward, BigInt(500_000_000), 250);

    const rows = await readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].wallet_id).toBe(BigInt(7));
    expect(rows[0].kind).toBe(OutgoingTxKind.forward);
    expect(rows[0].amount_halford).toBe(BigInt(500_000_000));
    expect(rows[0].size_bytes).toBe(BigInt(250));
    expect(rows[0].fee_halford).toBe(BigInt(100_000)); // |-0.001| GRC
  });

  it('resolves and leaves fee_halford NULL when gettransaction fails', async () => {
    mockRpc.getTransaction.mockRejectedValue(new Error('daemon down'));

    await expect(
      service.recordBroadcast(1, 'txid_fee_2', OutgoingTxKind.expired_refund, BigInt(1000)),
    ).resolves.not.toThrow();

    // The row itself must still be durable — only the fee is missing.
    const rows = await readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].fee_halford).toBeNull();
  });

  it('resolves when the DB insert itself fails', async () => {
    const spy = vi.spyOn(db, 'insertInto').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      await expect(
        service.recordBroadcast(1, 'txid_fee_3', OutgoingTxKind.forward, BigInt(1000)),
      ).resolves.not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(await readRows()).toHaveLength(0);
  });

  it('does not duplicate a row on a replayed txid and does not throw', async () => {
    await service.recordBroadcast(1, 'txid_dup', OutgoingTxKind.forward, BigInt(1000));

    await expect(
      service.recordBroadcast(1, 'txid_dup', OutgoingTxKind.forward, BigInt(1000)),
    ).resolves.not.toThrow();

    const rows = await readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].fee_halford).toBe(BigInt(100_000));
  });

  it('leaves fee_halford NULL when the daemon omits the fee field', async () => {
    // `fee` is only present when the tx IsFromMe() — a response
    // without it means the probe learned nothing.
    mockRpc.getTransaction.mockResolvedValue({ confirmations: 999 });

    await service.recordBroadcast(null, 'txid_nofee', OutgoingTxKind.consolidation, BigInt(1000));

    const rows = await readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].wallet_id).toBeNull();
    expect(rows[0].fee_halford).toBeNull();
  });
});
