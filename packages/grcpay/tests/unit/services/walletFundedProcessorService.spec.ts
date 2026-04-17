import { WalletFundedProcessorServiceClass } from '../../../src/services/wallet/walletFundedProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockWalletModel, createMockRpc, createSampleWalletRow } from '../../helpers/mocks';

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
    } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'incoming_tx') {
      return {
        vin: [{ txid: 'input_tx', vout: 0 }],
        vout: [],
      } as any;
    }
    return {
      vin: [],
      vout: [
        { scriptPubKey: { addresses: [SENDER_ADDR] } },
      ],
    } as any;
  });
}

describe('WalletFundedProcessorService', () => {
  let service: WalletFundedProcessorServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    mockRpc = createMockRpc();
    service = new WalletFundedProcessorServiceClass(mockWallet as any, mockRpc as any);
  });

  describe('processWithoutRecipient', () => {
    it('marks funded wallets without recipient as processed', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        recipient: null,
        status: 'funded',
        amount_required: BigInt(1000000000), // 10 GRC
        amount_recieved: BigInt(1000000000), // exact
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([wallet]) // without recipient
        .mockResolvedValueOnce([]); // with recipient

      await service.processFunded();

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: WalletStatus.processed,
          refund_tx: null,
          refund_amount: null,
          refund_attempts: 0,
        },
      });
    });

    it('emits log events for each processed wallet', async () => {
      const w1 = createSampleWalletRow({
        id: 1, address: 'Sa_1', recipient: null, status: 'funded',
        amount_required: BigInt(100), amount_recieved: BigInt(100),
      });
      const w2 = createSampleWalletRow({
        id: 2, address: 'Sa_2', recipient: null, status: 'funded',
        amount_required: BigInt(200), amount_recieved: BigInt(200),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([w1, w2])
        .mockResolvedValueOnce([]);

      await service.processFunded();

      const statusLogs = mockEmit.mock.calls.filter(
        (c: any[]) => c[1].action === 'status' && c[1].newStatus === WalletStatus.processed,
      );
      expect(statusLogs).toHaveLength(2);
    });

    it('refunds overpayment to sender and marks processed when recipient is null', async () => {
      const wallet = createSampleWalletRow({
        id: 7,
        address: WALLET_ADDR,
        recipient: null,
        status: 'funded',
        amount_required: BigInt(1000000000), // 10 GRC
        amount_recieved: BigInt(1200000000), // 12 GRC, 2 GRC overpayment
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([wallet])
        .mockResolvedValueOnce([]);
      wireFindSender(mockRpc);
      mockRpc.sendToAddress.mockResolvedValue('refund_tx_hash_no_recipient');

      await service.processFunded();

      // Refund happened
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_ADDR, expect.any(Number));
      const refundAmount = mockRpc.sendToAddress.mock.calls[0][1];
      expect(refundAmount).toBeCloseTo(1.999, 3); // overpayment - MIN_FEE

      // Wallet marked processed with refund_tx + refund_amount recorded
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          status: WalletStatus.processed,
          refund_tx: 'refund_tx_hash_no_recipient',
          // overpayment - fee = 2 - 0.001 = 1.999 GRC = 199900000 halford
          refund_amount: BigInt(199900000),
          refund_attempts: 0,
        },
      });

      // Audit log for the refund
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: 7,
        action: 'overpayment_refund',
        newStatus: 'refund_tx_hash_no_recipient',
      }));
    });
  });

  describe('processWithRecipient', () => {
    it('forwards exact required amount on exact payment, no refund', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000), // 10 GRC
        amount_recieved: BigInt(1000000000), // exact
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      mockRpc.sendToAddress.mockResolvedValue('tx_output_hash_123');

      await service.processFunded();

      expect(mockRpc.setTXfee).toHaveBeenCalledWith(0.001);
      // Only one sendToAddress call — the forward
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(
        RECIPIENT_ADDR,
        expect.any(Number),
        WALLET_ADDR,
      );
      const sentAmount = mockRpc.sendToAddress.mock.calls[0][1];
      expect(sentAmount).toBeCloseTo(9.999, 3);
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: WalletStatus.processed,
          tx_out: 'tx_output_hash_123',
          refund_tx: null,
          refund_amount: null,
          refund_attempts: 0,
        },
      });
    });

    it('refunds overpayment and forwards exact required amount when overpayment > fee', async () => {
      const wallet = createSampleWalletRow({
        id: 2,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000), // 10 GRC
        amount_recieved: BigInt(1200000000), // 12 GRC, 2 GRC overpayment
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireFindSender(mockRpc);
      // First call = refund, second call = forward
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_tx_abc')
        .mockResolvedValueOnce('forward_tx_def');

      await service.processFunded();

      // Both calls happened
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);

      // First: refund to sender, amount = overpayment - fee = 1.999
      const refundCall = mockRpc.sendToAddress.mock.calls[0];
      expect(refundCall[0]).toBe(SENDER_ADDR);
      expect(refundCall[1]).toBeCloseTo(1.999, 3);

      // Second: forward to recipient, amount = required - fee = 9.999
      const forwardCall = mockRpc.sendToAddress.mock.calls[1];
      expect(forwardCall[0]).toBe(RECIPIENT_ADDR);
      expect(forwardCall[1]).toBeCloseTo(9.999, 3);
      expect(forwardCall[2]).toBe(WALLET_ADDR);

      // Wallet update records both txids + the refund amount in halford
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          status: WalletStatus.processed,
          tx_out: 'forward_tx_def',
          refund_tx: 'refund_tx_abc',
          refund_amount: BigInt(199900000), // 1.999 GRC in halford
          refund_attempts: 0,
        },
      });

      // Audit log for the refund
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: 2,
        action: 'overpayment_refund',
        newStatus: 'refund_tx_abc',
      }));
    });

    it('skips refund on dust overpayment and forwards received amount (merchant tip)', async () => {
      const wallet = createSampleWalletRow({
        id: 3,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000), // 10 GRC
        amount_recieved: BigInt(1000050000), // 10.0005 GRC, 0.0005 overpayment (< 0.001 fee)
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      mockRpc.sendToAddress.mockResolvedValue('forward_tx_tip');

      await service.processFunded();

      // Only ONE sendToAddress call (no refund)
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      // Amount = received - fee = 10.0005 - 0.001 = 9.9995 (merchant gets the tip)
      const sentAmount = mockRpc.sendToAddress.mock.calls[0][1];
      expect(sentAmount).toBeCloseTo(9.9995, 4);

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: {
          status: WalletStatus.processed,
          tx_out: 'forward_tx_tip',
          refund_tx: null,
          refund_amount: null,
          refund_attempts: 0,
        },
      });

      // No overpayment_refund audit entry
      const refundLogs = mockEmit.mock.calls.filter(
        (c: any[]) => c[1].action === 'overpayment_refund',
      );
      expect(refundLogs).toHaveLength(0);
    });

    it('absorbs overpayment into merchant payout when sender cannot be determined', async () => {
      const wallet = createSampleWalletRow({
        id: 4,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000),
        amount_recieved: BigInt(1200000000),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      // Sender cannot be found: listTransactions returns empty
      mockRpc.listTransactions.mockResolvedValue([]);
      mockRpc.sendToAddress.mockResolvedValue('forward_tx_no_sender');

      await service.processFunded();

      // Only the forward happened — no refund call
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      // Forward amount = received - fee (merchant gets the overpayment as a tip)
      const sentAmount = mockRpc.sendToAddress.mock.calls[0][1];
      expect(sentAmount).toBeCloseTo(11.999, 3);

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: {
          status: WalletStatus.processed,
          tx_out: 'forward_tx_no_sender',
          refund_tx: null,
          refund_amount: null,
          refund_attempts: 0,
        },
      });
    });

    it('leaves wallet funded and bumps refund_attempts when the refund tx fails (first attempt)', async () => {
      const wallet = createSampleWalletRow({
        id: 5,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000),
        amount_recieved: BigInt(1200000000),
        refund_attempts: 0, // first attempt — backoff gate is a no-op
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireFindSender(mockRpc);
      mockRpc.sendToAddress.mockRejectedValueOnce(new Error('wallet is locked'));

      await service.processFunded();

      // Refund attempted, forward NOT attempted — we don't want to
      // forward the customer's overpayment to the merchant until we've
      // given the refund side a fair chance to succeed.
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_ADDR, expect.any(Number));

      // Wallet stays funded, refund_attempts climbs to 1.
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { refund_attempts: 1 },
      });
      // Crucially: no status transition.
      const statusTransitions = mockEmit.mock.calls.filter(
        (c: any[]) => c[1].action === 'status' && c[1].walletId === 5,
      );
      expect(statusTransitions).toHaveLength(0);

      // The refund_failed audit entry lands in db_logs.
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: 5,
        action: 'overpayment_refund_failed',
      }));
    });

    it('skips the refund attempt when the exponential-backoff window has not elapsed', async () => {
      const wallet = createSampleWalletRow({
        id: 10,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000),
        amount_recieved: BigInt(1200000000),
        refund_attempts: 2, // needs 2 * base (60s) elapsed
        updated_at: new Date(), // just now — well under 60s
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireFindSender(mockRpc);

      await service.processFunded();

      // Neither the refund RPC nor the forward RPC was called — we
      // skipped this wallet entirely for the cycle.
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      // And the wallet wasn't touched in the DB either (no bookkeeping
      // update, no status transition).
      expect(mockWallet.model.update).not.toHaveBeenCalled();
    });

    it('falls back to forwarding full balance after MAX_REFUND_ATTEMPTS refund failures', async () => {
      // Simulate the Nth attempt: the wallet arrives at the processor
      // already carrying refund_attempts = MAX_REFUND_ATTEMPTS - 1 from
      // previous cycles and an updated_at far enough in the past that
      // the exponential backoff window has elapsed. This is the
      // attempt that pushes it over the edge into the "abandoned"
      // path, at which point the merchant payout must go through so
      // the wallet doesn't wedge forever.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config } = require('../../../src/config');
      const farInThePast = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const wallet = createSampleWalletRow({
        id: 9,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000),
        amount_recieved: BigInt(1200000000),
        refund_attempts: config.MAX_REFUND_ATTEMPTS - 1,
        updated_at: farInThePast,
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireFindSender(mockRpc);
      mockRpc.sendToAddress
        .mockRejectedValueOnce(new Error('wallet is still locked'))
        .mockResolvedValueOnce('forward_tx_fallback');

      await service.processFunded();

      // Refund attempted (and failed), then the merchant forward
      // proceeds anyway with the full received balance.
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);
      const forwardCall = mockRpc.sendToAddress.mock.calls[1];
      expect(forwardCall[0]).toBe(RECIPIENT_ADDR);
      expect(forwardCall[1]).toBeCloseTo(11.999, 3);

      // Wallet marked processed, refund_attempts reset.
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          status: WalletStatus.processed,
          tx_out: 'forward_tx_fallback',
          refund_tx: null,
          refund_amount: null,
          refund_attempts: 0,
        },
      });
    });

    it('sets wallet to error on forward RPC failure', async () => {
      const wallet = createSampleWalletRow({
        id: 6,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(1000000000),
        amount_recieved: BigInt(1000000000),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      mockRpc.sendToAddress.mockRejectedValue(new Error('RPC timeout'));

      await service.processFunded();

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 6 },
        data: { status: WalletStatus.error },
      });
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'status',
        oldStatus: WalletStatus.funded,
        newStatus: WalletStatus.error,
      }));
    });

    it('emits tx_out log event on successful forward', async () => {
      const wallet = createSampleWalletRow({
        id: 8,
        address: WALLET_ADDR,
        status: 'funded',
        recipient: RECIPIENT_ADDR,
        amount_required: BigInt(500000000),
        amount_recieved: BigInt(500000000),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
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
      mockWallet.model.findMany.mockResolvedValue([]);

      await service.processFunded();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect(mockWallet.model.update).not.toHaveBeenCalled();
    });
  });
});
