import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { WalletFundedProcessorServiceClass } from '../../../src/services/wallet/walletFundedProcessorService';
import { WalletsServiceClass } from '../../../src/services/wallet/walletsService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

// wallets.splits JSON for a list of [address, halford] pairs.
function splitsJson(splits: [string, bigint][]): string {
  return JSON.stringify(splits.map(([address, halford]) => ({ address, amount: halford.toString() })));
}

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: vi.fn() }),
}));

const WALLET_ADDR = 'Swallet_addr_1234567890abcdefghijk';
const RECIPIENT_ADDR = 'Srecipient_addr_234567890abcdefg12';
const SENDER_ADDR = 'Ssender_addr_9876543210abcdefghij';

/**
 * listTransactions + getRawTransaction stubs that together make
 * findAllSenders return one sender (SENDER_ADDR) at the given GRC
 * amount. Used by tests that want the overpayment-refund path to have
 * a sender to send to.
 */
function wireFindSender(mockRpc: ReturnType<typeof createMockRpc>, grcAmount = 12) {
  mockRpc.listTransactions.mockResolvedValue([
    {
      category: 'receive',
      address: WALLET_ADDR,
      txid: 'incoming_tx',
      amount: grcAmount,
      time: 1000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'incoming_tx') {
      return {
        vin: [{ txid: 'input_tx', vout: 0 }],
        vout: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }
    return {
      vin: [],
      vout: [
        { scriptPubKey: { addresses: [SENDER_ADDR] } },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  });
}

async function readWallet(id: bigint) {
  return db
    .selectFrom('wallets')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

describe('WalletFundedProcessorService', () => {
  let service: WalletFundedProcessorServiceClass;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new WalletFundedProcessorServiceClass(mockRpc as never);
  });

  describe('processWithoutRecipient', () => {
    it('marks funded wallets without recipient as processed', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: null,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });

      await service.processFunded();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.refund_tx).toBeNull();
      expect(after.refund_amount).toBeNull();
      expect(after.refund_attempts).toBe(BigInt(0));
    });

    it('emits a status log event for each processed wallet', async () => {
      await insertWallet({
        address: 'Sa_1__addr_4567890abcdefghijklmnopq',
        recipient: null,
        status: WalletStatus.funded,
        amount_required: BigInt(100),
        amount_recieved: BigInt(100),
      });
      await insertWallet({
        address: 'Sa_2__addr_4567890abcdefghijklmnopq',
        recipient: null,
        status: WalletStatus.funded,
        amount_required: BigInt(200),
        amount_recieved: BigInt(200),
      });

      await service.processFunded();

      const statusLogs = mockEmit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any[]) => c[1].action === 'status' && c[1].newStatus === WalletStatus.processed,
      );
      expect(statusLogs).toHaveLength(2);
    });

    it('refunds overpayment to sender and marks processed when recipient is null', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: null,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
      });
      wireFindSender(mockRpc);
      mockRpc.sendToAddress.mockResolvedValue('refund_tx_hash_no_recipient');

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_ADDR, expect.any(Number));
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(1.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.refund_tx).toBe('refund_tx_hash_no_recipient');
      expect(after.refund_amount).toBe(BigInt(199_900_000));
      expect(after.refund_attempts).toBe(BigInt(0));

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'overpayment_refund',
        newStatus: 'refund_tx_hash_no_recipient',
      }));
    });
  });

  describe('processWithRecipient', () => {
    it('forwards exact required amount on exact payment, no refund', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendToAddress.mockResolvedValue('tx_output_hash_123');

      await service.processFunded();

      expect(mockRpc.setTXfee).toHaveBeenCalledWith(0.001);
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(
        RECIPIENT_ADDR,
        expect.any(Number),
        WALLET_ADDR,
      );
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(9.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('tx_output_hash_123');
      expect(after.refund_tx).toBeNull();
      expect(after.refund_amount).toBeNull();
    });

    it('records the fee the daemon charged for the forward', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendToAddress.mockResolvedValue('tx_output_hash_123');
      mockRpc.getTransaction.mockResolvedValue({ fee: -0.002 } as never);
      mockRpc.getRawTransaction.mockResolvedValue('ab'.repeat(1078) as never);

      await service.processFunded();

      expect(mockEmit).toHaveBeenCalledWith('log', {
        walletId: Number(row.id),
        action: 'tx_fee',
        newStatus: 'tx_output_hash_123',
        detail: 'charged 200000 halford, reserved 100000 halford, 1078 bytes',
      });
    });

    it('refunds the full overpayment and forwards required-minus-fee in ONE sendMany', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
      });
      wireFindSender(mockRpc);
      mockRpc.sendMany.mockResolvedValue('settle_tx_xyz');

      await service.processFunded();

      // Refund + forward go out as a single sendMany (one coin
      // selection) — no separate sendToAddress calls that could race
      // each other over the shared pool ("coins already spent").
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      const [account, recipients] = mockRpc.sendMany.mock.calls[0];
      expect(account).toBe('');
      // Fee policy A: buyer refunded the FULL overpayment (2 GRC),
      // merchant gets required - fee (9.999 GRC). One network fee.
      expect(recipients[SENDER_ADDR]).toBeCloseTo(2, 6);
      expect(recipients[RECIPIENT_ADDR]).toBeCloseTo(9.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      // tx_out and refund_tx both reference the single settle tx.
      expect(after.tx_out).toBe('settle_tx_xyz');
      expect(after.refund_tx).toBe('settle_tx_xyz');
      expect(after.refund_amount).toBe(BigInt(200_000_000));

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'overpayment_refund',
        newStatus: 'settle_tx_xyz',
      }));
    });

    it('skips refund on dust overpayment and forwards received amount (merchant tip)', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_050_000),
      });
      mockRpc.sendToAddress.mockResolvedValue('forward_tx_tip');

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(9.9995, 4);

      const after = await readWallet(row.id);
      expect(after.refund_tx).toBeNull();
      expect(after.refund_amount).toBeNull();

      const refundLogs = mockEmit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any[]) => c[1].action === 'overpayment_refund',
      );
      expect(refundLogs).toHaveLength(0);
    });

    it('absorbs overpayment into merchant payout when sender cannot be determined', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
      });
      mockRpc.listTransactions.mockResolvedValue([]);
      mockRpc.sendToAddress.mockResolvedValue('forward_tx_no_sender');

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(11.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('forward_tx_no_sender');
      expect(after.refund_tx).toBeNull();
      expect(after.refund_amount).toBeNull();
    });

    it('leaves wallet funded and bumps refund_attempts when the combined settle fails (first attempt)', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
        refund_attempts: 0,
      });
      wireFindSender(mockRpc);
      mockRpc.sendMany.mockRejectedValueOnce(new Error('transaction rejected — coins already spent'));

      await service.processFunded();

      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();

      const after = await readWallet(row.id);
      // Stays funded → re-picked + retried next tick (self-heal), NOT error.
      expect(after.status).toBe(WalletStatus.funded);
      expect(after.refund_attempts).toBe(BigInt(1));

      const statusTransitions = mockEmit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any[]) => c[1].action === 'status' && c[1].walletId === Number(row.id),
      );
      expect(statusTransitions).toHaveLength(0);

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'settle_retry',
      }));
    });

    it('skips the refund attempt when the exponential-backoff window has not elapsed', async () => {
      const justNow = new Date().toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
        refund_attempts: 2,
        updated_at: justNow,
      });
      wireFindSender(mockRpc);

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const after = await readWallet(row.id);
      expect(after.refund_attempts).toBe(BigInt(2));
      expect(after.updated_at).toBe(justNow);
    });

    it('escalates to error after FORWARD_RETRY_MAX_ATTEMPTS combined-settle failures', async () => {
      // Budgeted like the plain forward, not like a refund: a combined
      // settle IS a merchant forward and waits on the same daemon
      // liquidity, so it must get the full ~31min horizon.
      const { config } = await import('../../../src/config');
      const farInThePast = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
        refund_attempts: config.FORWARD_RETRY_MAX_ATTEMPTS - 1,
        created_at: farInThePast,
        updated_at: farInThePast,
      });
      wireFindSender(mockRpc);
      mockRpc.sendMany.mockRejectedValueOnce(new Error('still failing'));

      await service.processFunded();

      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();

      const after = await readWallet(row.id);
      // Persistent failure → operator review, not an infinite retry and
      // not a forced forward. Nothing broadcast, so no result columns.
      expect(after.status).toBe(WalletStatus.error);
      // The burned budget is carried forward, not zeroed: expireWallets
      // rate-limits its rescue on this counter, so zeroing here would
      // make the rescue fire instantly and bounce the row back.
      expect(after.refund_attempts).toBe(BigInt(config.FORWARD_RETRY_MAX_ATTEMPTS));
      expect(after.tx_out).toBeNull();
      expect(after.refund_tx).toBeNull();
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'status',
        detail: expect.stringContaining(`${config.FORWARD_RETRY_MAX_ATTEMPTS} attempts`),
      }));

      // The rescue is now rate-limited on refund_attempts, so age the
      // row past its backoff window before expecting expireWallets to
      // act. Without this dwell the row would bounce straight back and
      // churn, which is what the limiter exists to prevent.
      await db
        .updateTable('wallets')
        .set({ updated_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() })
        .where('id', '=', row.id)
        .execute();

      await new WalletsServiceClass().expireWallets();

      expect((await readWallet(row.id)).status).toBe(WalletStatus.expired);
    });

    it('self-heals: a previously-failed combined settle succeeds on a later tick', async () => {
      // A prior tick failed (e.g. cross-wallet "coins already spent"),
      // left the row funded with refund_attempts=1, past the backoff
      // window. loadFunded re-picks it and the retried sendMany lands.
      const farInThePast = new Date(Date.now() - 1000 * 60 * 60).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
        refund_attempts: 1,
        updated_at: farInThePast,
      });
      wireFindSender(mockRpc);
      mockRpc.sendMany.mockResolvedValue('settle_tx_retry');

      await service.processFunded();

      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('settle_tx_retry');
      expect(after.refund_tx).toBe('settle_tx_retry');
      expect(after.refund_attempts).toBe(BigInt(0));
    });

    it('leaves wallet funded and bumps refund_attempts when the forward fails (first attempt)', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        refund_attempts: 0,
      });
      mockRpc.sendToAddress.mockRejectedValueOnce(new Error('Insufficient funds'));

      await service.processFunded();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.funded);
      expect(after.refund_attempts).toBe(BigInt(1));

      const statusTransitions = mockEmit.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any[]) => c[1].action === 'status' && c[1].walletId === Number(row.id),
      );
      expect(statusTransitions).toHaveLength(0);

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'forward_retry',
      }));
    });

    it('carries the burned budget forward when exhausted forward retries escalate to error', async () => {
      const { config } = await import('../../../src/config');
      const farInThePast = new Date(Date.now() - 1000 * 60 * 60).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        refund_attempts: config.FORWARD_RETRY_MAX_ATTEMPTS - 1,
        updated_at: farInThePast,
      });
      mockRpc.sendToAddress.mockRejectedValueOnce(new Error('still insufficient'));

      await service.processFunded();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
      // Carried forward so expireWallets' rescue backs off rather than
      // firing immediately and churning the row back to `funded`.
      expect(after.refund_attempts).toBe(BigInt(config.FORWARD_RETRY_MAX_ATTEMPTS));
      expect(after.pending_broadcast).toBeNull();
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'status',
        oldStatus: WalletStatus.funded,
        newStatus: WalletStatus.error,
        detail: expect.stringContaining(`${config.FORWARD_RETRY_MAX_ATTEMPTS} attempts`),
      }));
    });

    it('lets expireWallets rescue a wallet parked by exhausted forward retries', async () => {
      const { config } = await import('../../../src/config');
      const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        refund_attempts: config.FORWARD_RETRY_MAX_ATTEMPTS - 1,
        created_at: longAgo,
        updated_at: longAgo,
      });
      mockRpc.sendToAddress.mockRejectedValueOnce(new Error('still insufficient'));

      await service.processFunded();
      let after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
      expect(after.refund_attempts).toBe(BigInt(config.FORWARD_RETRY_MAX_ATTEMPTS));

      // Age past the rescue backoff — see the sibling test above.
      await db
        .updateTable('wallets')
        .set({ updated_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() })
        .where('id', '=', row.id)
        .execute();
      await new WalletsServiceClass().expireWallets();

      after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.expired);
    });

    it('waits instead of attempting a doomed send when funds are not yet spendable', async () => {
      // The production shape: getreceivedbyaddress cleared
      // MIN_CONFIRMATIONS so the row is `funded`, but the daemon holds
      // the coin as untrusted and sendtoaddress would refuse. Asking it
      // anyway is the wasted work this gate exists to stop.
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.getWalletInfo.mockResolvedValueOnce({ balance: 0 });

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.funded);
      // Waiting is not a retry — the budget is for genuine send
      // failures, and maturity is wall-clock, not attempt-count.
      expect(after.refund_attempts).toBe(BigInt(0));
      expect(after.pending_broadcast).toBeNull();
    });

    it('forwards as soon as the funds become spendable, with no operator action', async () => {
      // The whole point of the change: a payout that the old code killed
      // on its first Insufficient-funds now simply lands on a later tick.
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.getWalletInfo.mockResolvedValueOnce({ balance: 0 });

      await service.processFunded();
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect((await readWallet(row.id)).status).toBe(WalletStatus.funded);

      // Next tick: the coin matured (or the hot wallet was topped up).
      mockRpc.getWalletInfo.mockResolvedValue({ balance: 1_000_000 });
      mockRpc.sendToAddress.mockResolvedValue('tx_after_maturity');

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('tx_after_maturity');
    });

    it('gates on getbalance, not on the deeper listunspent set', async () => {
      // Regression from a live testnet run that got this backwards.
      // The daemon carries two depth rules, seven blocks apart:
      //   GetBalance()  -> IsTrusted() && (IsConfirmed() || fFromMe)
      //                    IsConfirmed() is `depth >= 10`
      //   SelectCoins() -> AvailableCoins(fOnlyConfirmed = true)
      //                    IsTrusted() is `depth >= 3`
      // A customer payment has fFromMe = false, so listunspent 3 calls it
      // spendable at depth 3 while getbalance withholds it until 10. Coin
      // selection would take it — but sendtoaddress never gets there:
      // SendMoneyToDestination pre-checks
      // `nValue + nTransactionFee > GetBalance()` and bails first.
      // Gating on the wider set produced real "Insufficient funds" sends
      // on testnet at depth 8. Wait for the number the RPC checks.
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      // Coin selection would happily spend these...
      mockRpc.listUnspent.mockResolvedValue([
        { txid: 'utxo_depth_3', vout: 0, amount: 20, confirmations: 3 },
      ]);
      // ...but the RPC's own pre-check still says no.
      mockRpc.getWalletInfo.mockResolvedValue({ balance: 0 });

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect((await readWallet(row.id)).status).toBe(WalletStatus.funded);
      // Untouched: no attempt spent, nothing to back off from.
      expect((await readWallet(row.id)).refund_attempts).toBe(BigInt(0));
    });

    it('waits when the balance probe itself fails, without touching the row', async () => {
      // A daemon outage must not escape the per-wallet loop (that would
      // abort the tick for every remaining wallet) and must not mutate
      // state — nothing has been claimed or broadcast.
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.getWalletInfo.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.processFunded()).resolves.toBeUndefined();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.funded);
      expect(after.refund_attempts).toBe(BigInt(0));
      expect(after.pending_broadcast).toBeNull();
    });

    it('terminalizes past the deadline even when the balance probe keeps throwing', async () => {
      // The liveness bound must not depend on a working probe. `funded`
      // is invisible to expireWallets, so a probe that throws on every
      // tick would otherwise hold customer money there indefinitely.
      const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        lifespan_seconds: 60,
        created_at: longAgo,
        updated_at: longAgo,
      });
      mockRpc.getWalletInfo.mockRejectedValue(new Error('connection refused'));

      await expect(service.processFunded()).resolves.toBeUndefined();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
      // Counted, not zeroed: expireWallets rate-limits its rescue on
      // this counter, and a zero would make the rescue fire instantly
      // and bounce the row back to `funded` on every tick.
      expect(after.refund_attempts).toBe(BigInt(1));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'status',
        newStatus: WalletStatus.error,
        detail: expect.stringContaining('probe unavailable'),
      }));
    });

    it('terminalizes with the attempt counted when funds never become spendable by expiry', async () => {
      // The wait is bounded by the wallet's own lifespan. Past it, hand
      // the row to the refund path. The attempt is COUNTED, not reset:
      // expireWallets rate-limits its rescue on that counter, so a zero
      // would let the rescue fire instantly and churn the row.
      const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        lifespan_seconds: 60,
        created_at: longAgo,
        updated_at: longAgo,
      });
      mockRpc.getWalletInfo.mockResolvedValue({ balance: 0 });

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      let after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
      // Counted, not zeroed: expireWallets rate-limits its rescue on
      // this counter, and a zero would make the rescue fire instantly
      // and bounce the row back to `funded` on every tick.
      expect(after.refund_attempts).toBe(BigInt(1));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'status',
        newStatus: WalletStatus.error,
        detail: expect.stringContaining('never became spendable'),
      }));

      // And the rescue still fires once its backoff has elapsed — the
      // invariant that protects the buyer's money. Rate-limited, not
      // blocked.
      await db
        .updateTable('wallets')
        .set({ updated_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() })
        .where('id', '=', row.id)
        .execute();
      await new WalletsServiceClass().expireWallets();
      after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.expired);
    });

    it('emits tx_out log event on successful forward', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(500_000_000),
        amount_recieved: BigInt(500_000_000),
      });
      mockRpc.sendToAddress.mockResolvedValue('txhash_456');

      await service.processFunded();

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'tx_out',
        newStatus: 'txhash_456',
      }));
    });
  });

  describe('splits', () => {
    const SPLIT_A = 'Ssplit_a_addr_1234567890abcdefghij';
    const SPLIT_B = 'Ssplit_b_addr_1234567890abcdefghij';

    it('pays a split in the same sendMany, fee off the primary', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)]]), // 0.8 GRC of the 10 GRC invoice
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendMany.mockResolvedValue('split_tx');

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      const [account, outputs, minConf, comment] = mockRpc.sendMany.mock.calls[0];
      expect(account).toBe('');
      // Primary: 10 - 0.8 - 0.001. Split: exactly its amount.
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(9.199, 6);
      expect(outputs[SPLIT_A]).toBeCloseTo(0.8, 8);
      expect(Object.keys(outputs)).toHaveLength(2);
      // Tagged with the payment address like the single-output forward.
      expect(minConf).toBe(1);
      expect(comment).toBe(WALLET_ADDR);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('split_tx');
      expect(after.refund_tx).toBeNull();
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'split_paid',
        newStatus: 'split_tx',
      }));
    });

    it('refunds an overpayment, pays the primary and the split in ONE sendMany', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
      });
      wireFindSender(mockRpc);
      mockRpc.sendMany.mockResolvedValue('split_settle_tx');

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      const [, outputs] = mockRpc.sendMany.mock.calls[0];
      // Buyer gets the whole overpayment back; the split its amount;
      // the primary what is left less the one fee.
      expect(outputs[SENDER_ADDR]).toBeCloseTo(2, 6);
      expect(outputs[SPLIT_A]).toBeCloseTo(0.8, 8);
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(9.199, 6);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('split_settle_tx');
      expect(after.refund_tx).toBe('split_settle_tx');
      expect(after.refund_amount).toBe(BigInt(200_000_000));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split_paid', newStatus: 'split_settle_tx',
      }));
    });

    it('folds a dust split back into the primary and forwards exactly as without one', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(9_999_999)]]), // one halford under the 0.1 GRC floor
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendToAddress.mockResolvedValue('folded_tx');

      await service.processFunded();

      // Same single sendToAddress, same amount, as a wallet with no
      // splits at all.
      expect(mockRpc.sendMany).not.toHaveBeenCalled();
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(RECIPIENT_ADDR, expect.any(Number), WALLET_ADDR);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(9.999, 6);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('folded_tx');
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'split_folded',
        newStatus: 'folded_tx',
      }));
      const paid = mockEmit.mock.calls.filter((c) => c[1].action === 'split_paid');
      expect(paid).toHaveLength(0);
    });

    it('pays a split at exactly the dust floor', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(10_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendMany.mockResolvedValue('floor_tx');

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const [, outputs] = mockRpc.sendMany.mock.calls[0];
      expect(outputs[SPLIT_A]).toBeCloseTo(0.1, 8);
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(9.899, 6);
    });

    it('still settles a row whose split address equals the recipient (refused at creation) as one output', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[RECIPIENT_ADDR, BigInt(80_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendMany.mockResolvedValue('same_tx');

      await service.processFunded();

      const [, outputs] = mockRpc.sendMany.mock.calls[0];
      expect(Object.keys(outputs)).toEqual([RECIPIENT_ADDR]);
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(9.999, 6);
    });

    it('waits for spendable funds covering every output and the fee', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      // 9.5 GRC spendable covers the primary alone but not the whole
      // 10 GRC payout: nothing may be broadcast.
      mockRpc.getWalletInfo.mockResolvedValue({ balance: 9.5 });

      await service.processFunded();

      expect(mockRpc.sendMany).not.toHaveBeenCalled();
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.funded);
      expect(after.tx_out).toBeNull();
    });

    it('pays several splits as outputs of one sendMany', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)], [SPLIT_B, BigInt(150_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendMany.mockResolvedValue('multi_tx');

      await service.processFunded();

      expect(mockRpc.sendMany).toHaveBeenCalledTimes(1);
      const [, outputs] = mockRpc.sendMany.mock.calls[0];
      // Primary: 10 - 0.8 - 1.5 - 0.001.
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(7.699, 6);
      expect(outputs[SPLIT_A]).toBeCloseTo(0.8, 8);
      expect(outputs[SPLIT_B]).toBeCloseTo(1.5, 8);
      const paid = mockEmit.mock.calls.filter((c) => c[1].action === 'split_paid');
      expect(paid).toHaveLength(2);
    });

    it('pays the splits above the floor and folds the ones below it', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)], [SPLIT_B, BigInt(5_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendMany.mockResolvedValue('mixed_tx');

      await service.processFunded();

      const [, outputs] = mockRpc.sendMany.mock.calls[0];
      // The 0.05 GRC split stays with the primary: 10 - 0.8 - 0.001.
      expect(Object.keys(outputs).sort()).toEqual([RECIPIENT_ADDR, SPLIT_A].sort());
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(9.199, 6);
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split_folded', newStatus: 'mixed_tx',
      }));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split_paid', newStatus: 'mixed_tx',
      }));
    });
    it('folds a split that would leave the primary under 2x the fee', async () => {
      // A row the schema would have refused (e.g. created as 0.95 + dust
      // under a higher SPLIT_DUST): paying the 0.1 GRC split would push
      // the primary output negative.
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(95_000_000)], [SPLIT_B, BigInt(10_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(100_000_000),
        amount_recieved: BigInt(100_000_000),
      });
      mockRpc.sendMany.mockResolvedValue('floor_tx');

      await service.processFunded();

      const [, outputs] = mockRpc.sendMany.mock.calls[0];
      // 1 - 0.95 - 0.001; the 0.1 GRC split stays with the primary.
      expect(Object.keys(outputs).sort()).toEqual([RECIPIENT_ADDR, SPLIT_A].sort());
      expect(outputs[RECIPIENT_ADDR]).toBeCloseTo(0.049, 8);
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split_folded',
        newStatus: 'floor_tx',
        detail: expect.stringMatching(/under 2x the fee/),
      }));
    });
  });

  describe('split audit rows', () => {
    const SPLIT_A = 'Ssplit_a_addr_1234567890abcdefghij';

    it('logs the splits when recovery finishes a settle that crashed before its flip', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        tx_out: 'crashed_tx',
      });

      await service.processFunded();

      expect(mockRpc.sendMany).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split_paid', newStatus: 'crashed_tx',
      }));
    });

    it('logs the splits when a cancel wins the race after the forward broadcast', async () => {
      await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        splits: splitsJson([[SPLIT_A, BigInt(80_000_000)]]),
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      // The cancel lands while the forward is on its way out.
      mockRpc.sendMany.mockImplementation(async () => {
        await db.updateTable('wallets').set({ status: WalletStatus.expired })
          .where('address', '=', WALLET_ADDR).execute();
        return 'raced_tx';
      });

      await service.processFunded();

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'tx_out_after_cancel', newStatus: 'raced_tx',
      }));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split_paid', newStatus: 'raced_tx',
      }));
    });
  });

  describe('no work', () => {
    it('does nothing when no funded wallets', async () => {
      await service.processFunded();

      expect(mockRpc.setTXfee).not.toHaveBeenCalled();
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });
  });

  describe('rescue churn', () => {
    it('does not oscillate funded -> error -> funded on every tick', async () => {
      // Regression: the terminal flips used to zero refund_attempts so
      // the old `counter == 0` rescue gate could fire. That gate is now
      // a backoff, and canRetryRefund short-circuits to true at zero —
      // so zeroing made a partially-settled row rescuable instantly,
      // the funded processor parked it again next tick, and the pair
      // span at JOBS_INTERVAL cadence writing two db_logs per cycle.
      const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
        lifespan_seconds: 60,
        created_at: longAgo,
        updated_at: longAgo,
        // Partially settled: a refund already broadcast, so the rescue
        // routes this back to `funded` rather than to `expired`.
        refund_tx: 'prior_refund_tx',
        refund_amount: BigInt(1_000_000),
      });
      mockRpc.getWalletInfo.mockResolvedValue({ balance: 0 });

      await service.processFunded();
      expect((await readWallet(row.id)).status).toBe(WalletStatus.error);

      // Immediately afterwards the rescue must NOT fire.
      await new WalletsServiceClass().expireWallets();
      expect((await readWallet(row.id)).status).toBe(WalletStatus.error);

      // Nor on any number of back-to-back ticks.
      await new WalletsServiceClass().expireWallets();
      await new WalletsServiceClass().expireWallets();
      expect((await readWallet(row.id)).status).toBe(WalletStatus.error);
    });
  });
});
