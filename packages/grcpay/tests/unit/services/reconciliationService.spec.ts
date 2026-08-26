import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { ReconciliationServiceClass } from '../../../src/services/wallet/reconciliationService';
import { OutgoingTxKind } from '../../../src/lib/database';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db, now } from '../../../src/lib/db';
import { log } from '../../../src/lib/log';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: vi.fn() }),
}));

type MockRpc = ReturnType<typeof createMockRpc>;

async function insertOutgoingTx(txid: string, feeHalford: bigint | null): Promise<void> {
  await db
    .insertInto('outgoing_txs')
    .values({
      wallet_id: null,
      txid,
      kind: OutgoingTxKind.forward,
      amount_halford: BigInt(1_000_000_000),
      fee_halford: feeHalford,
      size_bytes: null,
      created_at: now(),
    })
    .execute();
}

describe('ReconciliationService', () => {
  let service: ReconciliationServiceClass;
  let mockRpc: MockRpc;
  let errorSpy: MockInstance;
  let warnSpy: MockInstance;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new ReconciliationServiceClass(mockRpc as never);
    errorSpy = vi.spyOn(log, 'error');
    warnSpy = vi.spyOn(log, 'warn');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fee overspend', () => {
    it('sums overspend across mixed null/non-null rows', async () => {
      // Real-incident figure (0.042 GRC), one tx at exactly MIN_FEE,
      // one not yet probed — the NULL must count toward neither side.
      await insertOutgoingTx('tx_big', BigInt(4_200_000));
      await insertOutgoingTx('tx_flat', BigInt(100_000));
      await insertOutgoingTx('tx_null', null);
      // Keep the backfill pass from filling tx_null mid-test.
      mockRpc.getTransaction.mockRejectedValue(new Error('probe off'));

      await service.reconcile();

      // total 4_300_000 − 2 recorded × 100_000 budget = 4_100_000.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('4100000'));
    });
  });

  describe('backfill', () => {
    it('fills a NULL fee and leaves already-recorded rows alone', async () => {
      await insertOutgoingTx('tx_missing', null);
      await insertOutgoingTx('tx_done', BigInt(4_200_000));
      // Default mock gettransaction → { fee: -0.001 }.

      await service.reconcile();

      const rows = await db.selectFrom('outgoing_txs').selectAll().execute();
      expect(rows.find((r) => r.txid === 'tx_missing')!.fee_halford).toBe(BigInt(100_000));
      expect(rows.find((r) => r.txid === 'tx_done')!.fee_halford).toBe(BigInt(4_200_000));
      // Only the NULL row was probed.
      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(1);
      expect(mockRpc.getTransaction).toHaveBeenCalledWith('tx_missing');
    });
  });

  describe('float', () => {
    it('logs at error level when float drops below RECONCILE_MIN_FLOAT', async () => {
      // Liability: a funded wallet holding 10 GRC the merchant is owed…
      await insertWallet({
        status: WalletStatus.funded,
        amount_recieved: BigInt(1_000_000_000),
      });
      // …but the daemon only holds 0.5 GRC.
      mockRpc.getWalletInfo.mockResolvedValue({ balance: 0.5 });

      await service.reconcile();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('RECONCILE_MIN_FLOAT'));
    });

    it('stays at info level when the float is healthy', async () => {
      await insertWallet({
        status: WalletStatus.funded,
        amount_recieved: BigInt(1_000_000_000),
      });
      // Mock default balance is 1_000_000 GRC — comfortably above.

      await service.reconcile();

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('spendability drift', () => {
    it('alerts when listunspent sees less than getreceivedbyaddress', async () => {
      const row = await insertWallet({
        status: WalletStatus.funded,
        amount_recieved: BigInt(500_000_000),
      });
      // The daemon's received ledger says 5 GRC, but every output is
      // below mininput so AvailableCoins offers nothing.
      mockRpc.getReceivedByAddress.mockResolvedValue(5);
      mockRpc.listUnspent.mockResolvedValue([]);

      await service.reconcile();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(row.address));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'spendability_drift',
        detail: expect.stringContaining(row.address),
      }));
    });

    it('does not alert when the two figures agree', async () => {
      await insertWallet({
        status: WalletStatus.funded,
        amount_recieved: BigInt(500_000_000),
      });
      mockRpc.getReceivedByAddress.mockResolvedValue(5);
      mockRpc.listUnspent.mockResolvedValue([{ amount: 5 }]);

      await service.reconcile();

      expect(mockEmit).not.toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'spendability_drift',
      }));
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('pass isolation', () => {
    it('runs the remaining passes when one throws', async () => {
      // Float pass (c) throws at the top…
      mockRpc.getWalletInfo.mockRejectedValue(new Error('daemon busy'));
      // …the drift pass (d) after it must still run and detect this.
      const row = await insertWallet({
        status: WalletStatus.funded,
        amount_recieved: BigInt(500_000_000),
      });
      mockRpc.getReceivedByAddress.mockResolvedValue(5);
      mockRpc.listUnspent.mockResolvedValue([]);

      await expect(service.reconcile()).resolves.not.toThrow();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('float pass failed'));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'spendability_drift',
      }));
    });
  });
});
