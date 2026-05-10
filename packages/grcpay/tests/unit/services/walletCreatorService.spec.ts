import { WalletsCreatorServiceClass } from '../../../src/services/wallet/walletCreatorService';
import { WalletMode } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

describe('WalletsCreatorService', () => {
  let service: WalletsCreatorServiceClass;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
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
});
