import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletsCreatorServiceClass } from '../../../src/services/wallet/walletCreatorService';
import { WalletMode } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll } from '../../helpers/db';

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: vi.fn() }),
}));

describe('WalletsCreatorService', () => {
  let service: WalletsCreatorServiceClass;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new WalletsCreatorServiceClass(mockRpc as never);
  });

  it('creates a wallet with a generated address', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

    const result = await service.createWallet(10);

    expect(mockRpc.getNewAddress).toHaveBeenCalled();
    expect(result.address).toBe('Sgenerated_address_1234567890abcde');
    expect(result.status).toBe('new');
    expect(result.amountRecieved).toBe(BigInt(0));

    const row = await db
      .selectFrom('wallets')
      .selectAll()
      .where('address', '=', 'Sgenerated_address_1234567890abcde')
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('new');
    expect(row.amount_required).toBe(BigInt(1_000_000_000));
    expect(row.amount_recieved).toBe(BigInt(0));
    expect(row.token_hash).toHaveLength(64);
  });

  it('refills keypool on getNewAddress failure', async () => {
    mockRpc.getNewAddress
      .mockRejectedValueOnce(new Error('keypool depleted'))
      .mockResolvedValueOnce('Srecovery_address_1234567890abcdef');

    await service.createWallet(5);

    expect(mockRpc.keyPoolRefill).toHaveBeenCalledWith(100);
    expect(mockRpc.getNewAddress).toHaveBeenCalledTimes(2);
  });

  it('throws when amountRequired is falsy', async () => {
    await expect(service.createWallet(0)).rejects.toThrow('Required amount is required');
    expect(mockRpc.getNewAddress).not.toHaveBeenCalled();
  });

  it('throws when generated address is empty', async () => {
    mockRpc.getNewAddress.mockResolvedValue('');
    await expect(service.createWallet(10)).rejects.toThrow('Unable to generate new address');
  });

  it('emits audit log events', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

    await service.createWallet(10, 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz');

    // amount_required, status, address, recipient, mode (lifespan only
    // emitted when a non-default value is supplied).
    expect(mockEmit).toHaveBeenCalledTimes(5);
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'amount_required' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'status', newStatus: 'new' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'address' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'recipient' }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({ action: 'mode', newStatus: 'checkout' }));
  });

  it('persists recipient when provided', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

    await service.createWallet(10, 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz');

    const row = await db
      .selectFrom('wallets')
      .selectAll()
      .where('address', '=', 'Sgenerated_address_1234567890abcde')
      .executeTakeFirstOrThrow();
    expect(row.recipient).toBe('SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz');
  });

  it('defaults mode to checkout and lifespan to null', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

    await service.createWallet(10);

    const row = await db
      .selectFrom('wallets')
      .selectAll()
      .where('address', '=', 'Sgenerated_address_1234567890abcde')
      .executeTakeFirstOrThrow();
    expect(row.mode).toBe('checkout');
    expect(row.lifespan_seconds).toBeNull();
  });

  it('emits a lifespan_seconds audit log entry when a custom lifespan is supplied', async () => {
    mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

    await service.createWallet(10, undefined, WalletMode.checkout, 3600);

    const row = await db
      .selectFrom('wallets')
      .select(['lifespan_seconds'])
      .where('address', '=', 'Sgenerated_address_1234567890abcde')
      .executeTakeFirstOrThrow();
    expect(row.lifespan_seconds).toBe(BigInt(3600));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      action: 'lifespan_seconds',
      newStatus: '3600',
    }));
  });

  it('rejects an invalid recipient address before minting one', async () => {
    mockRpc.validateAddress.mockResolvedValueOnce({ isvalid: false });

    await expect(
      service.createWallet(10, 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz'),
    ).rejects.toThrow(/not a valid Gridcoin address/);
    expect(mockRpc.getNewAddress).not.toHaveBeenCalled();
  });

  describe('splits', () => {
    const RECIPIENT = 'SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz';
    const SPLIT_A = 'SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i';
    const SPLIT_B = 'SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6j';
    const SPLITS = [{ address: SPLIT_A, amount: 0.8 }, { address: SPLIT_B, amount: 1.5 }];

    it('accepts a split amount Joi let through as a padded numeric string', async () => {
      mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');
      const padded = [{ address: SPLIT_A, amount: ' 0.8 ' as unknown as number }];

      const wallet = await service.createWallet(10, RECIPIENT, undefined, undefined, undefined, padded);

      expect(wallet.splits).toEqual([{ address: SPLIT_A, halford: BigInt(80_000_000) }]);
    });

    it('persists the splits in halford and logs one row per split', async () => {
      mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

      const wallet = await service.createWallet(10, RECIPIENT, undefined, undefined, undefined, SPLITS);

      expect(wallet.splits).toEqual([
        { address: SPLIT_A, halford: BigInt(80_000_000) },
        { address: SPLIT_B, halford: BigInt(150_000_000) },
      ]);
      const row = await db
        .selectFrom('wallets')
        .select(['splits', 'amount_required'])
        .where('address', '=', 'Sgenerated_address_1234567890abcde')
        .executeTakeFirstOrThrow();
      expect(JSON.parse(row.splits!)).toEqual([
        { address: SPLIT_A, amount: '80000000' },
        { address: SPLIT_B, amount: '150000000' },
      ]);
      // Splits are carved out of amount_required, not added to it.
      expect(row.amount_required).toBe(BigInt(1_000_000_000));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split', newStatus: SPLIT_A, detail: '80000000 halford',
      }));
      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'split', newStatus: SPLIT_B, detail: '150000000 halford',
      }));
    });

    it('stores null and logs no split without splits', async () => {
      mockRpc.getNewAddress.mockResolvedValue('Sgenerated_address_1234567890abcde');

      const wallet = await service.createWallet(10, RECIPIENT, undefined, undefined, undefined, []);

      expect(wallet.splits).toEqual([]);
      const row = await db
        .selectFrom('wallets')
        .select('splits')
        .where('address', '=', 'Sgenerated_address_1234567890abcde')
        .executeTakeFirstOrThrow();
      expect(row.splits).toBeNull();
      const actions = mockEmit.mock.calls.map((c) => c[1].action);
      expect(actions).not.toContain('split');
    });

    it('validates every split address with the daemon before minting', async () => {
      mockRpc.validateAddress
        .mockResolvedValueOnce({ isvalid: true })
        .mockResolvedValueOnce({ isvalid: true })
        .mockResolvedValueOnce({ isvalid: false });

      await expect(
        service.createWallet(10, RECIPIENT, undefined, undefined, undefined, SPLITS),
      ).rejects.toThrow(/Split address .* not a valid Gridcoin address/);
      expect(mockRpc.validateAddress).toHaveBeenCalledWith(SPLIT_A);
      expect(mockRpc.validateAddress).toHaveBeenCalledWith(SPLIT_B);
      expect(mockRpc.getNewAddress).not.toHaveBeenCalled();
    });

    it('refuses splits without a recipient to split with', async () => {
      await expect(
        service.createWallet(10, undefined, undefined, undefined, undefined, SPLITS),
      ).rejects.toThrow(/require a recipient/);
      expect(mockRpc.getNewAddress).not.toHaveBeenCalled();
      const rows = await db.selectFrom('wallets').select('id').execute();
      expect(rows).toHaveLength(0);
    });
  });
});
