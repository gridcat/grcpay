import { WalletFundedProcessorServiceClass } from '../../../src/services/wallet/walletFundedProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
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
    jest.clearAllMocks();
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

    it('escalates to error after MAX_REFUND_ATTEMPTS combined-settle failures', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { config } = require('../../../src/config');
      const farInThePast = new Date(Date.now() - 1000 * 60 * 60).toISOString();
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
        refund_attempts: config.MAX_REFUND_ATTEMPTS - 1,
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
      expect(after.refund_attempts).toBe(BigInt(config.MAX_REFUND_ATTEMPTS));
      expect(after.tx_out).toBeNull();
      expect(after.refund_tx).toBeNull();
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

    it('sets wallet to error on forward RPC failure', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_000_000_000),
      });
      mockRpc.sendToAddress.mockRejectedValue(new Error('RPC timeout'));

      await service.processFunded();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'status',
        oldStatus: WalletStatus.funded,
        newStatus: WalletStatus.error,
      }));
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

  describe('no work', () => {
    it('does nothing when no funded wallets', async () => {
      await service.processFunded();

      expect(mockRpc.setTXfee).not.toHaveBeenCalled();
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });
  });
});
