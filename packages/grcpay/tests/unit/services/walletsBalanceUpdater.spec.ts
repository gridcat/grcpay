import { WalletsBalanceUpdaterServiceClass } from '../../../src/services/wallet/walletsBalanceUpdater';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockWalletModel, createMockRpc } from '../../helpers/mocks';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

describe('WalletsBalanceUpdaterService', () => {
  let service: WalletsBalanceUpdaterServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    mockRpc = createMockRpc();
    service = new WalletsBalanceUpdaterServiceClass(mockWallet as any, mockRpc as any);
  });

  it('does nothing when no open wallets', async () => {
    mockWallet.model.findMany.mockResolvedValue([]);

    await service.updateBalances();

    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
  });

  it('checks balance for each open wallet', async () => {
    const wallets = [
      { id: 1, address: 'Saddr1_234567890abcdefghijklmnop', amount_recieved: BigInt(0) },
      { id: 2, address: 'Saddr2_234567890abcdefghijklmnop', amount_recieved: BigInt(0) },
    ];
    mockWallet.model.findMany.mockResolvedValue(wallets);
    mockRpc.getReceivedByAddress.mockResolvedValue(0);

    await service.updateBalances();

    expect(mockRpc.getReceivedByAddress).toHaveBeenCalledTimes(2);
    expect(mockRpc.getReceivedByAddress).toHaveBeenCalledWith('Saddr1_234567890abcdefghijklmnop');
    expect(mockRpc.getReceivedByAddress).toHaveBeenCalledWith('Saddr2_234567890abcdefghijklmnop');
  });

  it('updates DB when balance changes', async () => {
    const wallets = [
      { id: 1, address: 'Saddr1_234567890abcdefghijklmnop', amount_recieved: BigInt(0) },
    ];
    mockWallet.model.findMany.mockResolvedValue(wallets);
    // RPC returns 5 GRC
    mockRpc.getReceivedByAddress.mockResolvedValue(5);

    await service.updateBalances();

    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { amount_recieved: BigInt(500000000) },
    });
  });

  it('does not update DB when balance is unchanged', async () => {
    const wallets = [
      { id: 1, address: 'Saddr1_234567890abcdefghijklmnop', amount_recieved: BigInt(500000000) },
    ];
    mockWallet.model.findMany.mockResolvedValue(wallets);
    mockRpc.getReceivedByAddress.mockResolvedValue(5);

    await service.updateBalances();

    expect(mockWallet.model.update).not.toHaveBeenCalled();
  });

  it('emits log event on balance change', async () => {
    const wallets = [
      { id: 1, address: 'Saddr1_234567890abcdefghijklmnop', amount_recieved: BigInt(0) },
    ];
    mockWallet.model.findMany.mockResolvedValue(wallets);
    mockRpc.getReceivedByAddress.mockResolvedValue(10);

    await service.updateBalances();

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: 1,
      action: 'amount_recieved',
      oldStatus: '0',
      newStatus: String(BigInt(1000000000)),
    }));
  });

  it('queries only wallets with status new', async () => {
    mockWallet.model.findMany.mockResolvedValue([]);

    await service.updateBalances();

    expect(mockWallet.model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: WalletStatus.new },
      }),
    );
  });
});
