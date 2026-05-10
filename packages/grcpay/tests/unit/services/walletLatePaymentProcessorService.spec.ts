import { WalletLatePaymentProcessorServiceClass } from '../../../src/services/wallet/walletLatePaymentProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

const WALLET_ADDR = 'Swallet_late_1234567890abcdefghij';
const SENDER_ADDR = 'Slate_sender_9876543210abcdefghij';

function wireFindSender(mockRpc: ReturnType<typeof createMockRpc>, grcAmount: number) {
  mockRpc.listTransactions.mockResolvedValue([
    {
      category: 'receive',
      address: WALLET_ADDR,
      txid: 'late_incoming_tx',
      amount: grcAmount,
      time: 2000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'late_incoming_tx') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { vin: [{ txid: 'input_tx', vout: 0 }], vout: [] } as any;
    }
    return {
      vin: [],
      vout: [{ scriptPubKey: { addresses: [SENDER_ADDR] } }],
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

describe('WalletLatePaymentProcessorService', () => {
  let service: WalletLatePaymentProcessorServiceClass;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new WalletLatePaymentProcessorServiceClass(mockRpc as never);
  });

  it('does nothing when no terminal wallets are in the window', async () => {
    await service.processLatePayments();

    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
  });

  it('does nothing when the on-chain balance matches amount_recieved', async () => {
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(10);

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    const after = await readWallet(row.id);
    expect(after.updated_at).toBe(row.updated_at);
  });

  it('refunds a late payment above the fee to the latest sender', async () => {
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    wireFindSender(mockRpc, 2);
    mockRpc.sendToAddress.mockResolvedValue('late_refund_tx_1');

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
    const [to, amount] = mockRpc.sendToAddress.mock.calls[0];
    expect(to).toBe(SENDER_ADDR);
    expect(amount).toBeCloseTo(1.999, 3);

    const after = await readWallet(row.id);
    expect(after.amount_recieved).toBe(BigInt(1_200_000_000));
    expect(after.refund_amount).toBe(BigInt(199_900_000));
    expect(after.refund_tx).toBe('late_refund_tx_1');
    expect(after.refund_attempts).toBe(BigInt(0));

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'late_refund',
      newStatus: 'late_refund_tx_1',
    }));
  });

  it('accumulates late refund amounts when refund_tx is already set', async () => {
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
      refund_tx: 'earlier_overpayment_refund_tx',
      refund_amount: BigInt(50_000_000),
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(11);
    wireFindSender(mockRpc, 1);
    mockRpc.sendToAddress.mockResolvedValue('late_refund_tx_2');

    await service.processLatePayments();

    const after = await readWallet(row.id);
    expect(after.amount_recieved).toBe(BigInt(1_100_000_000));
    expect(after.refund_amount).toBe(BigInt(149_900_000));
    expect(after.refund_tx).toBe('earlier_overpayment_refund_tx');
    expect(after.refund_attempts).toBe(BigInt(0));
  });

  it('absorbs dust late payments without refunding', async () => {
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(10.0005);

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    const after = await readWallet(row.id);
    expect(after.amount_recieved).toBe(BigInt(1_000_050_000));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'late_dust',
    }));
  });

  it('absorbs late payments when the sender cannot be determined', async () => {
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    mockRpc.listTransactions.mockResolvedValue([]);

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    const after = await readWallet(row.id);
    expect(after.amount_recieved).toBe(BigInt(1_200_000_000));
  });

  it('bumps refund_attempts and does not bump amount_recieved when refund RPC fails', async () => {
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
      refund_attempts: 0,
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    wireFindSender(mockRpc, 2);
    mockRpc.sendToAddress.mockRejectedValue(new Error('wallet is locked'));

    await service.processLatePayments();

    const after = await readWallet(row.id);
    expect(after.amount_recieved).toBe(BigInt(1_000_000_000));
    expect(after.refund_attempts).toBe(BigInt(1));
  });

  it('gives up and bumps amount_recieved after MAX_REFUND_ATTEMPTS failures', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { config } = require('../../../src/config');
    const farInThePast = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
      refund_attempts: config.MAX_REFUND_ATTEMPTS - 1,
      updated_at: farInThePast,
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    wireFindSender(mockRpc, 2);
    mockRpc.sendToAddress.mockRejectedValue(new Error('still locked'));

    await service.processLatePayments();

    const after = await readWallet(row.id);
    expect(after.amount_recieved).toBe(BigInt(1_200_000_000));
    expect(after.refund_attempts).toBe(BigInt(0));

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'late_refund_abandoned',
    }));
  });

  it('skips a wallet whose backoff window has not elapsed', async () => {
    const justNow = new Date().toISOString();
    const row = await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
      refund_attempts: 2,
      updated_at: justNow,
    });

    await service.processLatePayments();

    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
    const after = await readWallet(row.id);
    expect(after.updated_at).toBe(justNow);
  });

  it('skips wallets whose updated_at is older than LATE_PAYMENT_WINDOW', async () => {
    // Eight days old — outside the default 7-day window.
    const wayOld = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString();
    await insertWallet({
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1_000_000_000),
      updated_at: wayOld,
    });

    await service.processLatePayments();

    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
  });
});
