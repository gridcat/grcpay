import { WalletExpiredProcessorServiceClass } from '../../../src/services/wallet/walletExpiredProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

const WALLET_ADDR = 'Sexpired_addr_234567890abcdefghijk';
const SENDER_A = 'SsenderA_addr_34567890abcdefghijk';
const SENDER_B = 'SsenderB_addr_34567890abcdefghijk';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'incoming_tx') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { vin: [{ txid: 'input_tx', vout: 0 }], vout: [] } as any;
    }
    return {
      vin: [],
      vout: [{ scriptPubKey: { addresses: [senderAddr] } }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  });
}

function wireTwoSenders(
  mockRpc: ReturnType<typeof createMockRpc>,
  walletAddr: string,
  a: { sender: string; amount: number; time: number },
  b: { sender: string; amount: number; time: number },
) {
  mockRpc.listTransactions.mockResolvedValue([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { category: 'receive', address: walletAddr, txid: 'tx_a', amount: a.amount, time: a.time } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { category: 'receive', address: walletAddr, txid: 'tx_b', amount: b.amount, time: b.time } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (txid === 'tx_a') return { vin: [{ txid: 'input_a', vout: 0 }], vout: [] } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (txid === 'tx_b') return { vin: [{ txid: 'input_b', vout: 0 }], vout: [] } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (txid === 'input_a') return { vin: [], vout: [{ scriptPubKey: { addresses: [a.sender] } }] } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (txid === 'input_b') return { vin: [], vout: [{ scriptPubKey: { addresses: [b.sender] } }] } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { vin: [], vout: [] } as any;
  });
}

async function readWallet(id: bigint) {
  return db
    .selectFrom('wallets')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

describe('WalletExpiredProcessorService', () => {
  let service: WalletExpiredProcessorServiceClass;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new WalletExpiredProcessorServiceClass(mockRpc as never);
  });

  describe('processWithZeroBalance', () => {
    it('marks expired empty wallets as norefund', async () => {
      const row = await insertWallet({
        address: 'Sempty_addr_4567890abcdefghijklmnop',
        status: WalletStatus.expired,
        amount_recieved: BigInt(0),
      });

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.norefund);
    });

    it('emits log events for norefund wallets', async () => {
      await insertWallet({
        address: 'Sempty_addr_4567890abcdefghijklmnop',
        status: WalletStatus.expired,
        amount_recieved: BigInt(0),
      });

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
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(500_000_000),
      });
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 5);
      mockRpc.sendToAddress.mockResolvedValue('refund_txid_123');

      await service.processExpired();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_A, expect.any(Number));
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(4.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.refunded);
      expect(after.tx_out).toBe('refund_txid_123');
      expect(after.refund_amount).toBe(BigInt(499_900_000));
    });

    it('sets to error when no senders can be determined', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(500_000_000),
      });
      mockRpc.listTransactions.mockResolvedValue([]);

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });

    it('marks as norefund when the only sender is dust-sized', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(50_000),
      });
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 0.0005);

      await service.processExpired();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.norefund);
    });

    it('sets to error when the only refund tx fails', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(1_000_000_000),
      });
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 10);
      mockRpc.sendToAddress.mockRejectedValue(new Error('Insufficient funds'));

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
    });
  });

  describe('processWithBalance - multi sender', () => {
    it('refunds each sender their own contribution independently', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(900_000_000),
      });
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 6, time: 1000 },
        { sender: SENDER_B, amount: 3, time: 2000 });
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_a_tx')
        .mockResolvedValueOnce('refund_b_tx');

      await service.processExpired();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);
      expect(mockRpc.sendToAddress.mock.calls[0][0]).toBe(SENDER_A);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(5.999, 3);
      expect(mockRpc.sendToAddress.mock.calls[1][0]).toBe(SENDER_B);
      expect(mockRpc.sendToAddress.mock.calls[1][1]).toBeCloseTo(2.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.refunded);
      expect(after.tx_out).toBe('refund_a_tx');
      expect(after.refund_amount).toBe(BigInt(899_800_000));
    });

    it('marks wallet as error when some refunds succeed and others fail', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(900_000_000),
      });
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 6, time: 1000 },
        { sender: SENDER_B, amount: 3, time: 2000 });
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_a_tx')
        .mockRejectedValueOnce(new Error('rpc glitch'));

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.error);
      expect(after.tx_out).toBe('refund_a_tx');
      expect(after.refund_amount).toBe(BigInt(599_900_000));
    });

    it('skips dust senders but refunds the non-dust ones', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(500_050_000),
      });
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 5, time: 1000 },
        { sender: SENDER_B, amount: 0.0005, time: 2000 });
      mockRpc.sendToAddress.mockResolvedValue('refund_a_tx');

      await service.processExpired();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendToAddress.mock.calls[0][0]).toBe(SENDER_A);
      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(4.999, 3);

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.refunded);
      expect(after.tx_out).toBe('refund_a_tx');
      expect(after.refund_amount).toBe(BigInt(499_900_000));
    });
  });

  describe('no work', () => {
    it('does nothing when no expired wallets', async () => {
      await service.processExpired();
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });
  });
});
