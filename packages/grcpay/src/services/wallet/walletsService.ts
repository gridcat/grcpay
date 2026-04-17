import { Wallet, WalletMode, WalletStatus } from '../../models/Wallet';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';

export class WalletsServiceClass {
  constructor(
    private wallet = new Wallet(),
  ) {}

  /**
   * Reconcile wallet statuses against the latest (confirmed, pending,
   * required) triple. Runs every job-loop tick right after
   * WalletsBalanceUpdaterService has refreshed the balances.
   *
   * Transition table (checkout mode only):
   *
   *   confirmed >= required                                    → funded
   *   confirmed <  required AND confirmed + pending >= required → confirming
   *   confirmed <  required AND confirmed + pending <  required → new
   *
   * Each reverse direction is also valid — if a pending tx drops out
   * of the mempool (reorg, low fee, replacement), a wallet can walk
   * back from `confirming` to `new` without confusing the processor.
   * `funded` is a one-way door: once the confirmed balance met the
   * invoice we stop reconciling this wallet (the funded processor
   * will take it from there and flip to `processed`).
   *
   * Only checkout-mode wallets transition via this path. Crowdfunding
   * wallets intentionally stay `new` until expiry — the expired
   * processor decides between "goal reached → settle" and "goal not
   * reached → refund", which keeps the funded processor a pure
   * checkout path and matches the all-or-nothing semantics.
   *
   * (The method name is retained as findFundedWallets because several
   * index.ts and test call sites rely on it; it's now doing more than
   * the name advertises but renaming is churn for no benefit.)
   */
  public async findFundedWallets(): Promise<void> {
    log.info('Reconcile open wallet statuses against latest balances');
    const candidates = await this.wallet.model.findMany({
      select: {
        id: true,
        status: true,
        amount_required: true,
        amount_recieved: true,
        amount_pending: true,
      },
      where: {
        status: {
          in: [WalletStatus.new, WalletStatus.confirming],
        },
        mode: WalletMode.checkout,
      },
    });

    const targetFor = (w: typeof candidates[number]): WalletStatus => {
      if (w.amount_recieved >= w.amount_required) return WalletStatus.funded;
      if (w.amount_recieved + w.amount_pending >= w.amount_required) return WalletStatus.confirming;
      return WalletStatus.new;
    };

    const buckets = new Map<WalletStatus, { id: number; oldStatus: string }[]>();
    for (const w of candidates) {
      const target = targetFor(w);
      if (target === w.status) continue;
      if (!buckets.has(target)) buckets.set(target, []);
      buckets.get(target)!.push({ id: w.id, oldStatus: w.status });
    }

    await Promise.all(Array.from(buckets.entries()).map(async ([newStatus, rows]) => {
      log.info(`${rows.length} wallet(s) reconciled to ${newStatus}`);
      await this.wallet.model.updateMany({
        data: { status: newStatus },
        where: { id: { in: rows.map((r) => r.id) } },
      });
      for (const { id, oldStatus } of rows) {
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: id,
          action: 'status',
          oldStatus,
          newStatus,
        });
      }
    }));
  }

  /**
   * Find all wallets which seems to be expired and update the status to expired
   *
   * @returns {Promise<void>}
   * @memberof WalletsServiceClass
   */
  public async expireWallets(): Promise<void> {
    // Check opened wallets.
    //
    // Per-wallet lifespan: each wallet may override config.LIFE_SPAN
    // via its own lifespan_seconds column (null means "use default").
    // We can't push that into a SQL date cutoff cleanly without a
    // CASE expression, so we fetch all open wallets and filter in
    // application code. The open set is bounded (new + error), so the
    // cost is small and the code is much easier to reason about.
    log.info('Check for expired wallets');
    const openedWallets = await this.wallet.model.findMany({
      select: {
        id: true,
        status: true,
        created_at: true,
        lifespan_seconds: true,
      },
      where: {
        status: {
          // `confirming` is included so a wallet that's been stuck
          // waiting for confirmations past its lifespan still ages
          // out and hands off to the refund flow, instead of hanging
          // around forever if a customer's tx stalled in the mempool.
          in: [
            WalletStatus.new,
            WalletStatus.confirming,
            WalletStatus.error,
          ],
        },
      },
    });
    const now = Date.now();
    const expiredWallets = openedWallets.filter((w) => {
      const lifespanSec = w.lifespan_seconds ?? config.LIFE_SPAN;
      const expiresAt = w.created_at.getTime() + lifespanSec * 1000;
      return expiresAt <= now;
    });
    const ids = expiredWallets.map((w) => w.id);
    if (ids.length) {
      log.info(`${ids.length} wallet(s) to be expired`);
      await this.wallet.model.updateMany({
        data: {
          status: WalletStatus.expired,
        },
        where: {
          id: {
            in: ids,
          },
        },
      });
      expiredWallets.forEach((wallet) => {
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'status',
          oldStatus: wallet.status,
          newStatus: WalletStatus.expired,
        });
      });
    }
  }
}

export const WalletsService = new WalletsServiceClass();
