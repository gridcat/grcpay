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

    it('refunds overpayment and forwards exact required amount when overpayment > fee', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
      });
      wireFindSender(mockRpc);
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_tx_abc')
        .mockResolvedValueOnce('forward_tx_def');

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);
      const refundCall = mockRpc.sendToAddress.mock.calls[0];
      expect(refundCall[0]).toBe(SENDER_ADDR);
      expect(refundCall[1]).toBeCloseTo(1.999, 3);
      const forwardCall = mockRpc.sendToAddress.mock.calls[1];
      expect(forwardCall[0]).toBe(RECIPIENT_ADDR);
      expect(forwardCall[1]).toBeCloseTo(9.999, 3);
      expect(forwardCall[2]).toBe(WALLET_ADDR);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('forward_tx_def');
      expect(after.refund_tx).toBe('refund_tx_abc');
      expect(after.refund_amount).toBe(BigInt(199_900_000));

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'overpayment_refund',
        newStatus: 'refund_tx_abc',
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

    it('leaves wallet funded and bumps refund_attempts when the refund tx fails (first attempt)', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        recipient: RECIPIENT_ADDR,
        status: WalletStatus.funded,
        amount_required: BigInt(1_000_000_000),
        amount_recieved: BigInt(1_200_000_000),
        refund_attempts: 0,
      });
      wireFindSender(mockRpc);
      mockRpc.sendToAddress.mockRejectedValueOnce(new Error('wallet is locked'));

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_ADDR, expect.any(Number));

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
        action: 'overpayment_refund_failed',
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

    it('falls back to forwarding full balance after MAX_REFUND_ATTEMPTS refund failures', async () => {
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
      mockRpc.sendToAddress
        .mockRejectedValueOnce(new Error('wallet is still locked'))
        .mockResolvedValueOnce('forward_tx_fallback');

      await service.processFunded();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);
      const forwardCall = mockRpc.sendToAddress.mock.calls[1];
      expect(forwardCall[0]).toBe(RECIPIENT_ADDR);
      expect(forwardCall[1]).toBeCloseTo(11.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.processed);
      expect(after.tx_out).toBe('forward_tx_fallback');
      expect(after.refund_tx).toBeNull();
      expect(after.refund_amount).toBeNull();
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
