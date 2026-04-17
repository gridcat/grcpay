import { WalletCancelServiceClass, WalletCancelError } from '../../../src/services/wallet/walletCancelService';
import { Wallet, WalletStatus, WalletMode } from '../../../src/models/Wallet';
import { createMockWalletModel } from '../../helpers/mocks';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

function newWallet(overrides: Partial<Wallet> = {}): Wallet {
  const w = new Wallet();
  w.id = 1;
  w.address = 'Swallet_1234567890abcdefghijklmn12';
  w.recipient = null;
  w.amountRequired = BigInt(1000000000);
  w.amountRecieved = BigInt(0);
  w.status = WalletStatus.new;
  w.mode = WalletMode.checkout;
  w.tokenHash = 'abc';
  w.refundAttempts = 0;
  Object.assign(w, overrides);
  return w;
}

describe('WalletCancelService', () => {
  let service: WalletCancelServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    service = new WalletCancelServiceClass(mockWallet as any);
  });

  it('transitions a new wallet to expired', async () => {
    const wallet = newWallet({ id: 42, status: WalletStatus.new });

    await service.cancelWallet(wallet);

    expect(mockWallet.model.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: WalletStatus.expired },
    });
  });

  it('emits both a status transition and a cancelled audit entry', async () => {
    const wallet = newWallet({ id: 7, status: WalletStatus.new });

    await service.cancelWallet(wallet);

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: 7,
      action: 'status',
      oldStatus: WalletStatus.new,
      newStatus: WalletStatus.expired,
    }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: 7,
      action: 'cancelled',
      newStatus: 'merchant',
    }));
  });

  it('rejects cancelling a funded wallet (already the merchant\'s money)', async () => {
    const wallet = newWallet({ status: WalletStatus.funded });

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
    expect(mockWallet.model.update).not.toHaveBeenCalled();
  });

  it.each([
    WalletStatus.processed,
    WalletStatus.refunded,
    WalletStatus.norefund,
    WalletStatus.expired,
    WalletStatus.error,
  ])('rejects cancelling a wallet already in terminal state %s', async (status) => {
    const wallet = newWallet({ status });

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
    expect(mockWallet.model.update).not.toHaveBeenCalled();
  });
});
