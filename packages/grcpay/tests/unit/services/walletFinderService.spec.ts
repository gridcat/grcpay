import { WalletsFinderServiceClass } from '../../../src/services/wallet/walletFinderService';
import { createMockWalletModel, createSampleWalletRow } from '../../helpers/mocks';

describe('WalletsFinderService', () => {
  let service: WalletsFinderServiceClass;
  let mockWallet: ReturnType<typeof createMockWalletModel>;

  beforeEach(() => {
    mockWallet = createMockWalletModel();
    service = new WalletsFinderServiceClass(mockWallet as any);
  });

  it('returns a wallet when found', async () => {
    const row = createSampleWalletRow({ address: 'Sfound_address_234567890abcdefgh12' });
    mockWallet.model.findFirst.mockResolvedValue(row);

    const result = await service.findWalletByAddress('Sfound_address_234567890abcdefgh12');

    expect(result.address).toBe('Sfound_address_234567890abcdefgh12');
    expect(mockWallet.model.findFirst).toHaveBeenCalledWith({
      where: { address: 'Sfound_address_234567890abcdefgh12' },
    });
  });

  it('throws when wallet is not found', async () => {
    mockWallet.model.findFirst.mockResolvedValue(null);

    await expect(service.findWalletByAddress('Snonexistent_addr_567890abcdefg12'))
      .rejects.toThrow('Wallet not found for address');
  });

  it('throws when address is empty', async () => {
    await expect(service.findWalletByAddress('')).rejects.toThrow('Address is required');
    expect(mockWallet.model.findFirst).not.toHaveBeenCalled();
  });
});
