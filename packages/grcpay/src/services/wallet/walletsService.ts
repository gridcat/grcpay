import { WalletMode, WalletStatus } from '../../models/Wallet';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';

export class WalletsServiceClass {
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
    const candidates = await db
      .selectFrom('wallets')
      .select([
        'id',
        'status',
        'amount_required',
        'amount_recieved',
        'amount_pending',
      ])
      .where('status', 'in', [WalletStatus.new, WalletStatus.confirming])
      .where('mode', '=', WalletMode.checkout)
      .execute();

    type Candidate = typeof candidates[number];
    const targetFor = (w: Candidate): WalletStatus => {
      if (w.amount_recieved >= w.amount_required) return WalletStatus.funded;
      if (w.amount_recieved + w.amount_pending >= w.amount_required) return WalletStatus.confirming;
      return WalletStatus.new;
    };

    const buckets = new Map<WalletStatus, { id: bigint; oldStatus: string }[]>();
    for (const w of candidates) {
      const target = targetFor(w);
      if (target === w.status) continue;
      if (!buckets.has(target)) buckets.set(target, []);
      buckets.get(target)!.push({ id: w.id, oldStatus: w.status });
    }

    await Promise.all(Array.from(buckets.entries()).map(async ([newStatus, rows]) => {
      log.info(`${rows.length} wallet(s) reconciled to ${newStatus}`);
      await db
        .updateTable('wallets')
        .set({ status: newStatus, updated_at: now() })
        .where('id', 'in', rows.map((r) => r.id))
        .execute();
      for (const { id, oldStatus } of rows) {
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(id),
          action: 'status',
          oldStatus,
          newStatus,
        });
      }
    }));
  }

  /**
   * Find all wallets which seems to be expired and update the status
   * to expired.
   */
  public async expireWallets(): Promise<void> {
    // Per-wallet lifespan: each wallet may override config.LIFE_SPAN
    // via its own lifespan_seconds column (null means "use default").
    // Filtering happens in JS because mixing a CASE expression with a
    // datetime cutoff in SQLite is harder to read than just walking
    // the bounded open set. Open status volume is small.
    log.info('Check for expired wallets');
    const openedWallets = await db
      .selectFrom('wallets')
      .select(['id', 'status', 'created_at', 'lifespan_seconds'])
      // `confirming` is included so a wallet stuck waiting for
      // confirmations past its lifespan still ages out and hands off
      // to the refund flow, instead of hanging around forever if a
      // customer's tx stalled in the mempool.
      .where('status', 'in', [
        WalletStatus.new,
        WalletStatus.confirming,
        WalletStatus.error,
      ])
      .execute();

    const nowMs = Date.now();
    const expired = openedWallets.filter((w) => {
      const lifespanSec = w.lifespan_seconds === null
        ? config.LIFE_SPAN
        : Number(w.lifespan_seconds);
      const expiresAt = new Date(w.created_at).getTime() + lifespanSec * 1000;
      return expiresAt <= nowMs;
    });
    if (!expired.length) return;
    log.info(`${expired.length} wallet(s) to be expired`);

    await db
      .updateTable('wallets')
      .set({ status: WalletStatus.expired, updated_at: now() })
      .where('id', 'in', expired.map((w) => w.id))
      .execute();

    expired.forEach((wallet) => {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'status',
        oldStatus: wallet.status,
        newStatus: WalletStatus.expired,
      });
    });
  }
}

export const WalletsService = new WalletsServiceClass();
