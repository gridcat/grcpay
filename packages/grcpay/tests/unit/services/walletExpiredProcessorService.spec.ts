import { WalletExpiredProcessorServiceClass } from '../../../src/services/wallet/walletExpiredProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { config } from '../../../src/config';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

const WALLET_ADDR = 'Sexpired_addr_234567890abcdefghijk';
const SENDER_A = 'SsenderA_addr_34567890abcdefghijk';
const SENDER_B = 'SsenderB_addr_34567890abcdefghijk';

type MockRpc = ReturnType<typeof createMockRpc>;

// LIVE balance the daemon reports. minconf===0 → 0-conf total (incl.
// mempool); anything else → the confirmed figure the refund gate uses.
function wireBalance(mockRpc: MockRpc, confirmedGrc: number, totalGrc = confirmedGrc) {
  mockRpc.getReceivedByAddress.mockImplementation(
    async (_addr: string, minconf?: number) => (minconf === 0 ? totalGrc : confirmedGrc),
  );
}

function wireSingleSender(
  mockRpc: MockRpc,
  walletAddr: string,
  senderAddr: string,
  grcAmount: number,
  time = 1000,
) {
  mockRpc.listTransactions.mockResolvedValue([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { category: 'receive', address: walletAddr, txid: 'incoming_tx', amount: grcAmount, time } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'incoming_tx') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { vin: [{ txid: 'input_tx', vout: 0 }], vout: [] } as any;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { vin: [], vout: [{ scriptPubKey: { addresses: [senderAddr] } }] } as any;
  });
}

function wireTwoSenders(
  mockRpc: MockRpc,
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
  return db.selectFrom('wallets').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();

describe('WalletExpiredProcessorService', () => {
  let service: WalletExpiredProcessorServiceClass;
  let mockRpc: MockRpc;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new WalletExpiredProcessorServiceClass(mockRpc as never);
  });

  describe('genuinely empty', () => {
    it('marks an expired wallet with zero live balance as norefund', async () => {
      // createMockRpc defaults getReceivedByAddress → 0 for all depths.
      const row = await insertWallet({
        address: 'Sempty_addr_4567890abcdefghijklmnop',
        status: WalletStatus.expired,
        amount_recieved: BigInt(0),
      });

      await service.processExpired();

      expect((await readWallet(row.id)).status).toBe(WalletStatus.norefund);
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'status',
        oldStatus: WalletStatus.expired,
        newStatus: WalletStatus.norefund,
      }));
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });
  });

  describe('cancel-with-funds race', () => {
    it('refunds even when cached amount_recieved is 0 but live confirmed balance exists', async () => {
      // Seller cancelled while the customer tx was still unconfirmed,
      // so amount_recieved froze at 0. It has since confirmed.
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(0),
      });
      wireBalance(mockRpc, 5);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 5);
      mockRpc.sendToAddress.mockResolvedValue('refund_txid_123');

      await service.processExpired();

      expect(mockRpc.sendToAddress).toHaveBeenCalledWith(SENDER_A, expect.any(Number));
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.refunded);
      expect(after.tx_out).toBe('refund_txid_123');
      expect(after.refund_amount).toBe(BigInt(499_900_000));
      expect(after.refund_attempts).toBe(BigInt(0));
    });

    it('does NOT terminalize while the inbound payment is still unconfirmed', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        amount_recieved: BigInt(0),
      });
      // 0-conf shows 5 GRC inbound, but nothing confirmed yet.
      wireBalance(mockRpc, 0, 5);

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.expired); // still waiting
      expect(after.refund_attempts).toBe(BigInt(0)); // not counted as a failure
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });
  });

  describe('transient sender-lookup miss → retry, not terminal error', () => {
    it('defers (stays expired, bumps attempts) on the first miss instead of erroring', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
      });
      wireBalance(mockRpc, 5);
      mockRpc.listTransactions.mockResolvedValue([]); // no senders resolvable yet

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.expired);
      expect(after.refund_attempts).toBe(BigInt(1));
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });

    it('terminalizes to error only once the retry budget is exhausted', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        refund_attempts: config.MAX_REFUND_ATTEMPTS - 1,
        updated_at: HOUR_AGO, // backoff window long elapsed
      });
      wireBalance(mockRpc, 5);
      mockRpc.listTransactions.mockResolvedValue([]);

      await service.processExpired();

      expect((await readWallet(row.id)).status).toBe(WalletStatus.error);
    });

    it('respects the backoff window between retries', async () => {
      const row = await insertWallet({
        address: WALLET_ADDR,
        status: WalletStatus.expired,
        refund_attempts: 1,
        updated_at: new Date().toISOString(), // just updated → backoff not elapsed
      });
      wireBalance(mockRpc, 5);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 5);

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.expired);
      expect(after.refund_attempts).toBe(BigInt(1)); // untouched this tick
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    });
  });

  describe('refund mechanics', () => {
    it('refunds the full received amount minus fee to a single sender', async () => {
      const row = await insertWallet({ address: WALLET_ADDR, status: WalletStatus.expired });
      wireBalance(mockRpc, 5);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 5);
      mockRpc.sendToAddress.mockResolvedValue('refund_txid_123');

      await service.processExpired();

      expect(mockRpc.sendToAddress.mock.calls[0][1]).toBeCloseTo(4.999, 3);
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.refunded);
      expect(after.refund_amount).toBe(BigInt(499_900_000));
    });

    it('refunds each sender their own contribution independently', async () => {
      const row = await insertWallet({ address: WALLET_ADDR, status: WalletStatus.expired });
      wireBalance(mockRpc, 9);
      wireTwoSenders(mockRpc, WALLET_ADDR,
        { sender: SENDER_A, amount: 6, time: 1000 },
        { sender: SENDER_B, amount: 3, time: 2000 });
      mockRpc.sendToAddress
        .mockResolvedValueOnce('refund_a_tx')
        .mockResolvedValueOnce('refund_b_tx');

      await service.processExpired();

      expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(2);
      expect(mockRpc.sendToAddress.mock.calls[0][0]).toBe(SENDER_A);
      expect(mockRpc.sendToAddress.mock.calls[1][0]).toBe(SENDER_B);
      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.refunded);
      expect(after.tx_out).toBe('refund_a_tx');
      expect(after.refund_amount).toBe(BigInt(899_800_000));
    });

    it('marks norefund when the only sender is dust-sized', async () => {
      const row = await insertWallet({ address: WALLET_ADDR, status: WalletStatus.expired });
      wireBalance(mockRpc, 0.0005);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 0.0005);

      await service.processExpired();

      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect((await readWallet(row.id)).status).toBe(WalletStatus.norefund);
    });

    it('defers (retries) when nothing went out because every send failed', async () => {
      const row = await insertWallet({ address: WALLET_ADDR, status: WalletStatus.expired });
      wireBalance(mockRpc, 10);
      wireSingleSender(mockRpc, WALLET_ADDR, SENDER_A, 10);
      mockRpc.sendToAddress.mockRejectedValue(new Error('Wallet locked'));

      await service.processExpired();

      const after = await readWallet(row.id);
      expect(after.status).toBe(WalletStatus.expired); // not a terminal error
      expect(after.refund_attempts).toBe(BigInt(1));
    });

    it('parks in error on PARTIAL success (retry would double-pay)', async () => {
      const row = await insertWallet({ address: WALLET_ADDR, status: WalletStatus.expired });
      wireBalance(mockRpc, 9);
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
  });

  describe('no work', () => {
    it('does nothing when there are no expired wallets', async () => {
      await service.processExpired();
      expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
      expect(mockRpc.setTXfee).not.toHaveBeenCalled();
    });
  });
});
