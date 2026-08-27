import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WalletsFinderServiceClass } from '../../../src/services/wallet/walletFinderService';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

describe('WalletsFinderService', () => {
  const service = new WalletsFinderServiceClass();

  beforeAll(setupTestDb);
  beforeEach(truncateAll);

  it('returns a wallet when found', async () => {
    await insertWallet({ address: 'Sfound_address_234567890abcdefgh12' });

    const result = await service.findWalletByAddress('Sfound_address_234567890abcdefgh12');

    expect(result.address).toBe('Sfound_address_234567890abcdefgh12');
  });

  it('throws when wallet is not found', async () => {
    await expect(service.findWalletByAddress('Snonexistent_addr_567890abcdefg12'))
      .rejects.toThrow('Wallet not found for address');
  });

  it('throws when address is empty', async () => {
    await expect(service.findWalletByAddress('')).rejects.toThrow('Address is required');
  });
});
