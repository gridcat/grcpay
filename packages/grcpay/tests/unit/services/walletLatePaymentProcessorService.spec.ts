import { WalletLatePaymentProcessorServiceClass } from '../../../src/services/wallet/walletLatePaymentProcessorService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockWalletModel, createMockRpc, createSampleWalletRow } from '../../helpers/mocks';

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
    } as any,
  ]);
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    if (txid === 'late_incoming_tx') {
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

describe('WalletLatePaymentProcessorService', () => {
  let service: WalletLatePaymentProcessorServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    mockRpc = createMockRpc();
    service = new WalletLatePaymentProcessorServiceClass(mockWallet as any, mockRpc as any);
  });

  it('does nothing when no terminal wallets are in the window', async () => {
    mockWallet.model.findMany.mockResolvedValue([]);

    await service.processLatePayments();

    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
  });

  it('does nothing when the on-chain balance matches amount_recieved', async () => {
    const wallet = createSampleWalletRow({
      id: 1,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000), // 10 GRC
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    mockRpc.getReceivedByAddress.mockResolvedValue(10); // matches

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    expect(mockWallet.model.update).not.toHaveBeenCalled();
  });

  it('refunds a late payment above the fee to the latest sender', async () => {
    const wallet = createSampleWalletRow({
      id: 2,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000), // previously 10 GRC
      refund_tx: null,
      refund_amount: null,
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    // On-chain balance is 12 GRC — 2 GRC late payment.
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    wireFindSender(mockRpc, 2);
    mockRpc.sendToAddress.mockResolvedValue('late_refund_tx_1');

    await service.processLatePayments();

    // Refund sent to sender for delta - fee = 2 - 0.001 = 1.999 GRC
    expect(mockRpc.sendToAddress).toHaveBeenCalledTimes(1);
    const [to, amount] = mockRpc.sendToAddress.mock.calls[0];
    expect(to).toBe(SENDER_ADDR);
    expect(amount).toBeCloseTo(1.999, 3);

    // Wallet bumped: amount_recieved to new balance, refund_amount
    // populated, refund_tx captured, attempts reset.
    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: {
        amount_recieved: BigInt(1200000000),
        refund_amount: BigInt(199900000), // 1.999 GRC
        refund_tx: 'late_refund_tx_1',
        refund_attempts: 0,
      },
    });

    // Audit entry.
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: 2,
      action: 'late_refund',
      newStatus: 'late_refund_tx_1',
    }));
  });

  it('accumulates late refund amounts when refund_tx is already set', async () => {
    const wallet = createSampleWalletRow({
      id: 3,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000),
      refund_tx: 'earlier_overpayment_refund_tx',
      refund_amount: BigInt(50000000), // 0.5 GRC already refunded earlier
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    mockRpc.getReceivedByAddress.mockResolvedValue(11); // 1 GRC late
    wireFindSender(mockRpc, 1);
    mockRpc.sendToAddress.mockResolvedValue('late_refund_tx_2');

    await service.processLatePayments();

    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        amount_recieved: BigInt(1100000000),
        // Cumulative: 0.5 GRC prior + 0.999 GRC late refund = 1.499 GRC
        refund_amount: BigInt(149900000),
        // refund_tx preserved — the original overpayment txid stays
        // authoritative, and the late refund lands in db_logs only.
        refund_tx: 'earlier_overpayment_refund_tx',
        refund_attempts: 0,
      },
    });
  });

  it('absorbs dust late payments without refunding', async () => {
    const wallet = createSampleWalletRow({
      id: 4,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000),
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    // Delta = 0.0005 GRC — smaller than the 0.001 GRC fee.
    mockRpc.getReceivedByAddress.mockResolvedValue(10.0005);

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    // amount_recieved bumped so we don't keep re-detecting it.
    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { amount_recieved: BigInt(1000050000) },
    });
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: 4,
      action: 'late_dust',
    }));
  });

  it('absorbs late payments when the sender cannot be determined', async () => {
    const wallet = createSampleWalletRow({
      id: 5,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000),
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    mockRpc.getReceivedByAddress.mockResolvedValue(12); // 2 GRC late
    // listTransactions returns nothing — sender lookup fails.
    mockRpc.listTransactions.mockResolvedValue([]);

    await service.processLatePayments();

    expect(mockRpc.sendToAddress).not.toHaveBeenCalled();
    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { amount_recieved: BigInt(1200000000) },
    });
  });

  it('bumps refund_attempts and does not bump amount_recieved when refund RPC fails', async () => {
    const wallet = createSampleWalletRow({
      id: 6,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000),
      refund_attempts: 0, // no prior failures, backoff gate is a no-op
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    wireFindSender(mockRpc, 2);
    mockRpc.sendToAddress.mockRejectedValue(new Error('wallet is locked'));

    await service.processLatePayments();

    // amount_recieved NOT bumped — next cycle needs to re-detect and
    // retry the same delta.
    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 6 },
      data: { refund_attempts: 1 },
    });
  });

  it('gives up and bumps amount_recieved after MAX_REFUND_ATTEMPTS failures', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../../../src/config');
    const farInThePast = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    const wallet = createSampleWalletRow({
      id: 7,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000),
      refund_attempts: config.MAX_REFUND_ATTEMPTS - 1, // one away from the cap
      updated_at: farInThePast, // backoff window already elapsed
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);
    mockRpc.getReceivedByAddress.mockResolvedValue(12);
    wireFindSender(mockRpc, 2);
    mockRpc.sendToAddress.mockRejectedValue(new Error('still locked'));

    await service.processLatePayments();

    // amount_recieved bumped so we stop retrying this delta, counter
    // reset so anything new that lands later starts fresh.
    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        amount_recieved: BigInt(1200000000),
        refund_attempts: 0,
      },
    });
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: 7,
      action: 'late_refund_abandoned',
    }));
  });

  it('skips a wallet whose backoff window has not elapsed', async () => {
    const wallet = createSampleWalletRow({
      id: 8,
      address: WALLET_ADDR,
      status: WalletStatus.processed,
      amount_recieved: BigInt(1000000000),
      refund_attempts: 2, // needs 2 * base seconds elapsed
      updated_at: new Date(), // just now
    });
    mockWallet.model.findMany.mockResolvedValue([wallet]);

    await service.processLatePayments();

    // We never even fetched the on-chain balance — the wallet was
    // skipped before the RPC call.
    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
    expect(mockWallet.model.update).not.toHaveBeenCalled();
  });

  it('scopes the query to terminal statuses within LATE_PAYMENT_WINDOW', async () => {
    mockWallet.model.findMany.mockResolvedValue([]);

    await service.processLatePayments();

    expect(mockWallet.model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              WalletStatus.processed,
              WalletStatus.refunded,
              WalletStatus.norefund,
            ],
          },
          updated_at: expect.objectContaining({
            gte: expect.any(Date),
          }),
        }),
      }),
    );
  });
});
