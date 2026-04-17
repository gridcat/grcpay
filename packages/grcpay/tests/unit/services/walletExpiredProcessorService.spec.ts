import { WalletExpiredProcessorServiceClass } from '../../../src/services/wallet/walletExpiredProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockWalletModel, createMockRpc, createSampleWalletRow } from '../../helpers/mocks';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

const WALLET_ADDR = 'Sexpired_addr_234567890abcdefghijk';
const SENDER_A = 'SsenderA_addr_34567890abcdefghijk';
const SENDER_B = 'SsenderB_addr_34567890abcdefghijk';

/**
 * Wires the RPC mocks so findAllSenders sees a single incoming tx of
 * `grcAmount` from `senderAddr`. Returns the fake txid used.
 */
function wireSingleSender(
  mockRpc: ReturnType<typeof createMockRpc>,
  walletAddr: string,
  senderAddr: string,
  grcAmount: number,
  time = 1000,
) {
  mockRpc.listTransactions.mockResolvedValue([
    {
      category: 'receive',
      address: walletAddr,
      txid: 'incoming_tx',
      amount: grcAmount,
      time,
    } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'incoming_tx') {
      return { vin: [{ txid: 'input_tx', vout: 0 }], vout: [] } as any;
    }
    return {
      vin: [],
      vout: [{ scriptPubKey: { addresses: [senderAddr] } }],
    } as any;
  });
}

/**
 * Wires the RPC mocks so findAllSenders sees two incoming txs from two
 * different senders at different times. Used for multi-sender tests.
 */
function wireTwoSenders(
  mockRpc: ReturnType<typeof createMockRpc>,
  walletAddr: string,
  a: { sender: string; amount: number; time: number },
  b: { sender: string; amount: number; time: number },
) {
  mockRpc.listTransactions.mockResolvedValue([
    { category: 'receive', address: walletAddr, txid: 'tx_a', amount: a.amount, time: a.time } as any,
    { category: 'receive', address: walletAddr, txid: 'tx_b', amount: b.amount, time: b.time } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'tx_a') return { vin: [{ txid: 'input_a', vout: 0 }], vout: [] } as any;
    if (txid === 'tx_b') return { vin: [{ txid: 'input_b', vout: 0 }], vout: [] } as any;
    if (txid === 'input_a') return { vin: [], vout: [{ scriptPubKey: { addresses: [a.sender] } }] } as any;
    if (txid === 'input_b') return { vin: [], vout: [{ scriptPubKey: { addresses: [b.sender] } }] } as any;
    return { vin: [], vout: [] } as any;
  });
}

describe('WalletExpiredProcessorService', () => {
  let service: WalletExpiredProcessorServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    mockRpc = createMockRpc();
    service = new WalletExpiredProcessorServiceClass(mockWallet as any, mockRpc as any);
  });

  describe('processWithZeroBalance', () => {
    it('marks expired empty wallets as norefund', async () => {
      mockWallet.model.findMany
        .mockResolvedValueOnce([{ id: 1 }]) // zero balance
        .mockResolvedValueOnce([]); // with balance
      mockWallet.model.updateMany.mockResolvedValue({ count: 1 });

      await service.processExpired();

      expect(mockWallet.model.updateMany).toHaveBeenCalledWith({
        data: { status: WalletStatus.norefund },
        where: { id: { in: [1] } },
      });
    });

    it('emits log events for norefund wallets', async () => {
      mockWallet.model.findMany
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([]);
      mockWallet.model.updateMany.mockResolvedValue({ count: 1 });

      await service.processExpired();

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'status',
        oldStatus: WalletStatus.expired,
        newStatus: WalletStatus.norefund,
      }));
    });
  });

  describe('processWithBalance - single sender', () => {
    it('refunds the full received amount minus fee to the sender', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(500000000), // 5 GRC
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([]) // zero-balance
        .mockResolvedValueOnce([wallet]); // with balance
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 5);
      mockRpc.sendToAddress.mockResolvedValue('refund_txid_123');

      await service.processExpired();

      // One refund call: 5 - 0.001 = 4.999 to sender A
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_A, expect.any(Number));
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(4.999, 3);

      // Wallet marked refunded with tx + total refund amount recorded
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: WalletStatus.refunded,
          tx_out: 'refund_txid_123',
          refund_amount: BigInt(499900000), // 4.999 GRC in halford
        },
      });
    });

    it('sets to error when no senders can be determined', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(500000000),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      mockRpc.listTransactions.mockResolvedValue([]); // no incoming txs

      await service.processExpired();

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: WalletStatus.error },
      });
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });

    it('marks as norefund when the only sender is dust-sized', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(50000), // 0.0005 GRC (< 0.001 fee)
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 0.0005);

      await service.processExpired();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      // No refund happened and no tx failed → norefund (nothing worth returning)
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: WalletStatus.norefund },
      });
    });

    it('sets to error when the only refund tx fails', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(1000000000),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 10);
      mockRpc.sendToAddress.mockRejectedValue(new Error('Insufficient funds'));

      await service.processExpired();

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: WalletStatus.error },
      });
    });
  });

  describe('processWithBalance - multi sender', () => {
    it('refunds each sender their own contribution independently', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(900000000), // 9 GRC total (underfunded on a 10 GRC wallet)
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 6, time: 1000 },
        { sender: SENDER_B, amount: 3, time: 2000 });
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_a_tx')
        .mockResolvedValueOnce('refund_b_tx');

      await service.processExpired();

      // Two refund calls: A gets 6 - 0.001 = 5.999, B gets 3 - 0.001 = 2.999.
      // Order is ascending by latestTime, so A (time 1000) first, then B (time 2000).
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);
      expect(mockRpc.sendToAddress.mock.calls[0][0]).toBe(SENDER_A);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(5.999, 3);
      expect(mockRpc.sendToAddress.mock.calls[1][0]).toBe(SENDER_B);
      expect(mockRpc.sendToAddress.mock.calls[1][1]).toBeCloseTo(2.999, 3);

      // tx_out holds the FIRST refund txid, refund_amount is the sum
      // (5.999 + 2.999 = 8.998 GRC, in halford).
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: WalletStatus.refunded,
          tx_out: 'refund_a_tx',
          refund_amount: BigInt(899800000),
        },
      });
    });

    it('marks wallet as error when some refunds succeed and others fail', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(900000000),
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 6, time: 1000 },
        { sender: SENDER_B, amount: 3, time: 2000 });
      // A succeeds, B fails.
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_a_tx')
        .mockRejectedValueOnce(new Error('rpc glitch'));

      await service.processExpired();

      // Partial success → error status for manual review, but the
      // refund that DID go through is recorded on tx_out + refund_amount.
      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: WalletStatus.error,
          tx_out: 'refund_a_tx',
          refund_amount: BigInt(599900000), // just A's refund, 5.999 GRC
        },
      });
    });

    it('skips dust senders but refunds the non-dust ones', async () => {
      const wallet = createSampleWalletRow({
        id: 1,
        address: WALLET_ADDR,
        status: 'expired',
        amount_recieved: BigInt(500050000), // 5.0005 GRC (5 from A, 0.0005 from B)
      });
      mockWallet.model.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wallet]);
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 5, time: 1000 },
        { sender: SENDER_B, amount: 0.0005, time: 2000 });
      mockRpc.sendToAddress.mockResolvedValue('refund_a_tx');

      await service.processExpired();

      // Only one refund call — B was below dust threshold
      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress.mock.calls[0][0]).toBe(SENDER_A);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(4.999, 3);

      expect(mockWallet.model.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: WalletStatus.refunded,
          tx_out: 'refund_a_tx',
          refund_amount: BigInt(499900000), // just A's share
        },
      });
    });
  });

  describe('no work', () => {
    it('does nothing when no expired wallets', async () => {
      mockWallet.model.findMany.mockResolvedValue([]);

      await service.processExpired();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect(mockWallet.model.update).not.toHaveBeenCalled();
    });
  });
});
