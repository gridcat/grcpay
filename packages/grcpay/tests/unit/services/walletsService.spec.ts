import { WalletsServiceClass } from '../../../src/services/wallet/walletsService';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockWalletModel, createSampleWalletRow } from '../../helpers/mocks';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

describe('WalletsService', () => {
  let service: WalletsServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = createMockWalletModel();
    service = new WalletsServiceClass(mockWallet as any);
  });

  describe('findFundedWallets', () => {
    it('marks wallets as funded when amount_recieved >= amount_required', async () => {
      const fundedRow = {
        id: 1,
        status: WalletStatus.new,
        amount_required: BigInt(100000000),
        amount_recieved: BigInt(100000000),
      };
      mockWallet.model.findMany.mockResolvedValue([fundedRow]);
      mockWallet.model.updateMany.mockResolvedValue({ count: 1 });

      await service.findFundedWallets();

      expect(mockWallet.model.updateMany).toHaveBeenCalledWith({
        data: { status: WalletStatus.funded },
        where: { id: { in: [1] } },
      });
    });

    it('does not mark wallets where amount_recieved < amount_required', async () => {
      const unfundedRow = {
        id: 1,
        status: WalletStatus.new,
        amount_required: BigInt(200000000),
        amount_recieved: BigInt(100000000),
      };
      mockWallet.model.findMany.mockResolvedValue([unfundedRow]);

      await service.findFundedWallets();

      expect(mockWallet.model.updateMany).not.toHaveBeenCalled();
    });

    it('handles empty result', async () => {
      mockWallet.model.findMany.mockResolvedValue([]);

      await service.findFundedWallets();

      expect(mockWallet.model.updateMany).not.toHaveBeenCalled();
    });

    it('scopes the findMany query to checkout-mode wallets only', async () => {
      mockWallet.model.findMany.mockResolvedValue([]);

      await service.findFundedWallets();

      expect(mockWallet.model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: WalletStatus.new,
            mode: 'checkout',
          }),
        }),
      );
    });

    it('emits log events for each funded wallet', async () => {
      const rows = [
        { id: 1, status: WalletStatus.new, amount_required: BigInt(100), amount_recieved: BigInt(100) },
        { id: 2, status: WalletStatus.new, amount_required: BigInt(200), amount_recieved: BigInt(300) },
      ];
      mockWallet.model.findMany.mockResolvedValue(rows);
      mockWallet.model.updateMany.mockResolvedValue({ count: 2 });

      await service.findFundedWallets();

      expect(mockEmit).toHaveBeenCalledTimes(2);
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: 1,
        action: 'status',
        newStatus: WalletStatus.funded,
      }));
    });
  });

  describe('expireWallets', () => {
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24); // 24h ago
    const recently = new Date(Date.now() - 1000 * 60); // 1 minute ago

    it('marks old wallets as expired using the default LIFE_SPAN', async () => {
      const oldRow = {
        id: 5,
        status: WalletStatus.new,
        created_at: longAgo,
        lifespan_seconds: null,
      };
      mockWallet.model.findMany.mockResolvedValue([oldRow]);
      mockWallet.model.updateMany.mockResolvedValue({ count: 1 });

      await service.expireWallets();

      expect(mockWallet.model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [WalletStatus.new, WalletStatus.error] },
          }),
        }),
      );
      expect(mockWallet.model.updateMany).toHaveBeenCalledWith({
        data: { status: WalletStatus.expired },
        where: { id: { in: [5] } },
      });
    });

    it('leaves recent wallets alone even when the default LIFE_SPAN is short', async () => {
      const freshRow = {
        id: 6,
        status: WalletStatus.new,
        created_at: recently,
        lifespan_seconds: null,
      };
      mockWallet.model.findMany.mockResolvedValue([freshRow]);

      await service.expireWallets();

      expect(mockWallet.model.updateMany).not.toHaveBeenCalled();
    });

    it('honours per-wallet lifespan_seconds override (short lifespan expires early)', async () => {
      // Created 2 minutes ago but lifespan is 60s → should expire.
      const twoMinAgo = new Date(Date.now() - 1000 * 120);
      const shortLifespan = {
        id: 7,
        status: WalletStatus.new,
        created_at: twoMinAgo,
        lifespan_seconds: 60,
      };
      mockWallet.model.findMany.mockResolvedValue([shortLifespan]);
      mockWallet.model.updateMany.mockResolvedValue({ count: 1 });

      await service.expireWallets();

      expect(mockWallet.model.updateMany).toHaveBeenCalledWith({
        data: { status: WalletStatus.expired },
        where: { id: { in: [7] } },
      });
    });

    it('honours per-wallet lifespan_seconds override (long lifespan keeps wallet alive)', async () => {
      // Created 24h ago but lifespan is 30 days → should not expire,
      // even though the default LIFE_SPAN would have flagged it.
      const longLifespan = {
        id: 8,
        status: WalletStatus.new,
        created_at: longAgo,
        lifespan_seconds: 60 * 60 * 24 * 30,
      };
      mockWallet.model.findMany.mockResolvedValue([longLifespan]);

      await service.expireWallets();

      expect(mockWallet.model.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing when no wallets to expire', async () => {
      mockWallet.model.findMany.mockResolvedValue([]);

      await service.expireWallets();

      expect(mockWallet.model.updateMany).not.toHaveBeenCalled();
    });

    it('emits log events for expired wallets', async () => {
      mockWallet.model.findMany.mockResolvedValue([{
        id: 3,
        status: WalletStatus.new,
        created_at: longAgo,
        lifespan_seconds: null,
      }]);
      mockWallet.model.updateMany.mockResolvedValue({ count: 1 });

      await service.expireWallets();

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: 3,
        action: 'status',
        oldStatus: WalletStatus.new,
        newStatus: WalletStatus.expired,
      }));
    });
  });
});
