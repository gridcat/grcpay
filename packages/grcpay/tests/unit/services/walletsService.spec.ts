import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { WalletsServiceClass } from '../../../src/services/wallet/walletsService';
import { WalletStatus } from '../../../src/models/Wallet';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: vi.fn() }),
}));

async function status(id: bigint): Promise<string> {
  const row = await db
    .selectFrom('wallets')
    .select(['status'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.status;
}

describe('WalletsService', () => {
  const service = new WalletsServiceClass();

  beforeAll(setupTestDb);
  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateAll();
  });

  describe('findFundedWallets', () => {
    it('marks wallets as funded when amount_recieved >= amount_required', async () => {
      const row = await insertWallet({
        address: 'Sfunded_addr_4567890abcdefghijklmn',
        amount_required: BigInt(100_000_000),
        amount_recieved: BigInt(100_000_000),
        status: WalletStatus.new,
      });

      await service.findFundedWallets();

      expect(await status(row.id)).toBe(WalletStatus.funded);
    });

    it('marks wallets as confirming when confirmed+pending covers the invoice', async () => {
      const row = await insertWallet({
        address: 'Sconfm_addr_4567890abcdefghijklmn1',
        amount_required: BigInt(100_000_000),
        amount_recieved: BigInt(40_000_000),
        amount_pending: BigInt(70_000_000),
        status: WalletStatus.new,
      });

      await service.findFundedWallets();

      expect(await status(row.id)).toBe(WalletStatus.confirming);
    });

    it('walks confirming back to new when pending drops out of mempool', async () => {
      const row = await insertWallet({
        address: 'Srevert_addr_4567890abcdefghijklmn',
        amount_required: BigInt(100_000_000),
        amount_recieved: BigInt(20_000_000),
        amount_pending: BigInt(0),
        status: WalletStatus.confirming,
      });

      await service.findFundedWallets();

      expect(await status(row.id)).toBe(WalletStatus.new);
    });

    it('does not transition wallets where confirmed+pending < required', async () => {
      const row = await insertWallet({
        address: 'Sunder_addr_4567890abcdefghijklmn1',
        amount_required: BigInt(200_000_000),
        amount_recieved: BigInt(50_000_000),
        amount_pending: BigInt(50_000_000),
        status: WalletStatus.new,
      });

      await service.findFundedWallets();

      expect(await status(row.id)).toBe(WalletStatus.new);
    });

    it('handles empty result', async () => {
      await service.findFundedWallets();
      // No assertion beyond "doesn't throw" — empty DB is the
      // default after truncateAll.
    });

    it('emits log events on transitions', async () => {
      await insertWallet({
        address: 'Sevent_addr_4567890abcdefghijklmn1',
        amount_required: BigInt(100),
        amount_recieved: BigInt(100),
        status: WalletStatus.new,
      });

      await service.findFundedWallets();

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        action: 'status',
        newStatus: WalletStatus.funded,
      }));
    });
  });

  describe('expireWallets', () => {
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const recently = new Date(Date.now() - 1000 * 60).toISOString();

    it('marks old wallets as expired using the default LIFE_SPAN', async () => {
      const row = await insertWallet({
        address: 'Sold_addr_234567890abcdefghijklm123',
        status: WalletStatus.new,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.expired);
    });

    it('leaves recent wallets alone', async () => {
      const row = await insertWallet({
        address: 'Sfresh_addr_234567890abcdefghijkl12',
        status: WalletStatus.new,
        created_at: recently,
        updated_at: recently,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.new);
    });

    it('honours per-wallet lifespan_seconds override (short lifespan expires early)', async () => {
      const twoMinAgo = new Date(Date.now() - 1000 * 120).toISOString();
      const row = await insertWallet({
        address: 'Sshort_addr_234567890abcdefghijkl12',
        status: WalletStatus.new,
        lifespan_seconds: 60,
        created_at: twoMinAgo,
        updated_at: twoMinAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.expired);
    });

    it('honours per-wallet lifespan_seconds override (long lifespan keeps wallet alive)', async () => {
      const row = await insertWallet({
        address: 'Slong_addr_234567890abcdefghijklm12',
        status: WalletStatus.new,
        lifespan_seconds: 60 * 60 * 24 * 30,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.new);
    });

    it('expires confirming wallets too once their lifespan is up', async () => {
      const row = await insertWallet({
        address: 'Sconfx_addr_234567890abcdefghijkl12',
        status: WalletStatus.confirming,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.expired);
    });

    it('rescues an error row that burned its refund budget — money is never abandoned', async () => {
      // The stranding regression: the expired processor parks a wallet
      // in `error` with refund_attempts at the ceiling after its refund
      // attempts fail (typically because the coins are not yet
      // spendable). That row still holds customer money that was
      // NEITHER forwarded nor refunded. Requiring refund_attempts = 0
      // here meant nothing ever revisited it again.
      const row = await insertWallet({
        address: 'Sburned_addr_34567890abcdefghijkl1',
        status: WalletStatus.error,
        tx_out: null,
        refund_tx: null,
        refund_attempts: 5,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.expired);
    });

    it('rate-limits that rescue instead of churning error->expired->error', async () => {
      // The other half of the bargain: the row comes back, but only
      // once its capped backoff window has elapsed, so a genuinely
      // stuck wallet retries quietly rather than every tick.
      const justNow = new Date().toISOString();
      const row = await insertWallet({
        address: 'Sburned_recent_4567890abcdefghijk1',
        status: WalletStatus.error,
        tx_out: null,
        refund_tx: null,
        refund_attempts: 5,
        created_at: longAgo,
        updated_at: justNow,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.error);
    });

    it('routes a partially-settled error row back to funded, not to the refund path', async () => {
      // Overpayment refund already broadcast, merchant forward never
      // did. Sending this to `expired` would let the buyer-refund
      // processor pay out the GROSS balance and refund the buyer twice;
      // excluding it entirely (the old behaviour) stranded the
      // merchant's principal. The only correct recovery is to finish
      // the forward, so it goes back to `funded`.
      const row = await insertWallet({
        address: 'Spartial_addr_567890abcdefghijkl1',
        status: WalletStatus.error,
        tx_out: null,
        refund_tx: 'overpayment_refund_tx',
        refund_amount: BigInt(200_000_000),
        refund_attempts: 5,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.funded);
    });

    it('still refuses to touch an error row that already sent money out', async () => {
      const row = await insertWallet({
        address: 'Sforwarded_addr_567890abcdefghijk1',
        status: WalletStatus.error,
        tx_out: 'already_forwarded_tx',
        refund_attempts: 5,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(await status(row.id)).toBe(WalletStatus.error);
    });

    it('does nothing when no wallets to expire', async () => {
      await service.expireWallets();
      // Just smoke-tests the empty path.
    });

    it('emits log events for expired wallets', async () => {
      const row = await insertWallet({
        address: 'Selog_addr_234567890abcdefghijklm12',
        status: WalletStatus.new,
        created_at: longAgo,
        updated_at: longAgo,
      });

      await service.expireWallets();

      expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
        walletId: Number(row.id),
        action: 'status',
        oldStatus: WalletStatus.new,
        newStatus: WalletStatus.expired,
      }));
    });
  });
});
