import { WalletCancelServiceClass, WalletCancelError } from '../../../src/services/wallet/walletCancelService';
import { Wallet, WalletStatus, WalletMode } from '../../../src/models/Wallet';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

function walletWithStatus(id: number, status: WalletStatus): Wallet {
  const w = new Wallet();
  w.id = id;
  w.address = 'Swallet_1234567890abcdefghijklmn12';
  w.recipient = null;
  w.amountRequired = BigInt(1_000_000_000);
  w.amountRecieved = BigInt(0);
  w.amountPending = BigInt(0);
  w.status = status;
  w.mode = WalletMode.checkout;
  w.tokenHash = 'abc';
  w.refundAttempts = 0;
  return w;
}

describe('WalletCancelService', () => {
  const service = new WalletCancelServiceClass();

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
  });

  it('transitions a new wallet to expired', async () => {
    const row = await insertWallet({ status: WalletStatus.new });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.new);
    wallet.address = row.address;

    await service.cancelWallet(wallet);

    const after = await db
      .selectFrom('wallets')
      .select(['status'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('expired');
  });

  it('emits both a status transition and a cancelled audit entry', async () => {
    const row = await insertWallet({ status: WalletStatus.new });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.new);

    await service.cancelWallet(wallet);

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'status',
      oldStatus: WalletStatus.new,
      newStatus: WalletStatus.expired,
    }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'cancelled',
      newStatus: 'merchant',
    }));
  });

  it('rejects cancelling a funded wallet (already the merchant\'s money)', async () => {
    const wallet = walletWithStatus(1, WalletStatus.funded);

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
  });

  it.each([
    WalletStatus.processed,
    WalletStatus.refunded,
    WalletStatus.norefund,
    WalletStatus.expired,
    WalletStatus.error,
  ])('rejects cancelling a wallet already in terminal state %s', async (status) => {
    const wallet = walletWithStatus(1, status);

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
  });
});
