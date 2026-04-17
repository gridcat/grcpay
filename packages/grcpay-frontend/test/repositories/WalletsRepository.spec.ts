import { describe, it, expect, vi } from 'vitest';
import { WalletsRepository } from '@/repositories/WalletsRepository';

describe('WalletsRepository', () => {
  describe('getQrUrl', () => {
    it('builds a QR URL with the default width', () => {
      const repo = new WalletsRepository();
      const url = repo.getQrUrl('SXabc');
      expect(url).toMatch(/\/wallets\/SXabc\/qr\?filter\[width\]=256$/);
    });

    it('honours an explicit width', () => {
      const repo = new WalletsRepository();
      expect(repo.getQrUrl('SXabc', 512)).toMatch(/filter\[width\]=512$/);
    });
  });

  describe('createWallet', () => {
    it('posts a JSON:API envelope and returns a parsed entity', async () => {
      const fakeAxios = {
        post: vi.fn().mockResolvedValue({
          data: {
            data: {
              type: 'wallets',
              id: '1',
              attributes: {
                address: 'SXabc',
                amountRequired: 1,
                amountReceived: 0,
                status: 'new',
              },
            },
          },
        }),
        get: vi.fn(),
      } as unknown as typeof import('axios').default;
      const repo = new WalletsRepository(fakeAxios);
      const wallet = await repo.createWallet({ amountRequired: 1 });
      expect(wallet).not.toBeNull();
      expect(wallet?.address).toBe('SXabc');
      expect(wallet?.status).toBe('new');
    });
  });
});
