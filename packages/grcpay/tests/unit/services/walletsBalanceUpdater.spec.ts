import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletsBalanceUpdaterServiceClass } from '../../../src/services/wallet/walletsBalanceUpdater';
import { WalletStatus } from '../../../src/models/Wallet';
import { createMockRpc } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: vi.fn() }),
}));

describe('WalletsBalanceUpdaterService', () => {
  let service: WalletsBalanceUpdaterServiceClass;
  let mockRpc: ReturnType<typeof createMockRpc>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
    service = new WalletsBalanceUpdaterServiceClass(mockRpc as never);
  });

  it('does nothing when no open wallets', async () => {
    await service.updateBalances();

    expect(mockRpc.getReceivedByAddress).not.toHaveBeenCalled();
  });

  it('checks balance for each open wallet', async () => {
    await insertWallet({ address: 'Saddr1_234567890abcdefghijklmnop12', status: WalletStatus.new });
    await insertWallet({ address: 'Saddr2_234567890abcdefghijklmnop12', status: WalletStatus.new });
    mockRpc.getReceivedByAddress.mockResolvedValue(0);

    await service.updateBalances();

    // Two wallets × two probes each (confirmed + 0-conf) = 4 calls.
    expect(mockRpc.getReceivedByAddress).toHaveBeenCalledTimes(4);
    expect(mockRpc.getReceivedByAddress).toHaveBeenCalledWith('Saddr1_234567890abcdefghijklmnop12', expect.any(Number));
    expect(mockRpc.getReceivedByAddress).toHaveBeenCalledWith('Saddr2_234567890abcdefghijklmnop12', expect.any(Number));
  });

  it('updates DB when confirmed balance changes', async () => {
    const row = await insertWallet({
      address: 'Sbal_addr_4567890abcdefghijklmnopq',
      amount_recieved: BigInt(0),
      amount_pending: BigInt(0),
      status: WalletStatus.new,
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(5); // both confirmed and 0-conf

    await service.updateBalances();

    const updated = await db
      .selectFrom('wallets')
      .select(['amount_recieved', 'amount_pending'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(updated.amount_recieved).toBe(BigInt(500_000_000));
    expect(updated.amount_pending).toBe(BigInt(0));
  });

  it('records the pending delta when 0-conf exceeds confirmed', async () => {
    const row = await insertWallet({
      address: 'Spend_addr_4567890abcdefghijklmnopq',
      amount_recieved: BigInt(0),
      amount_pending: BigInt(0),
      status: WalletStatus.new,
    });
    // Confirmed call returns 0, 0-conf call returns 5 GRC.
    mockRpc.getReceivedByAddress
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(5);

    await service.updateBalances();

    const updated = await db
      .selectFrom('wallets')
      .select(['amount_recieved', 'amount_pending'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(updated.amount_recieved).toBe(BigInt(0));
    expect(updated.amount_pending).toBe(BigInt(500_000_000));
  });

  it('does not update DB when balance is unchanged', async () => {
    const row = await insertWallet({
      address: 'Ssame_addr_4567890abcdefghijklmnopq',
      amount_recieved: BigInt(500_000_000),
      amount_pending: BigInt(0),
      status: WalletStatus.new,
      updated_at: new Date(2020, 0, 1).toISOString(),
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(5);

    await service.updateBalances();

    const updated = await db
      .selectFrom('wallets')
      .select(['updated_at'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(updated.updated_at).toBe(row.updated_at);
  });

  it('emits log event on balance change', async () => {
    const row = await insertWallet({
      address: 'Slogn_addr_4567890abcdefghijklmnopq',
      status: WalletStatus.new,
    });
    mockRpc.getReceivedByAddress.mockResolvedValue(10);

    await service.updateBalances();

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'amount_recieved',
      oldStatus: '0',
      newStatus: String(BigInt(1_000_000_000)),
    }));
  });
});
