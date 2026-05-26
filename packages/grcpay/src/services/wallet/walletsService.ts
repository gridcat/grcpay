import { WalletMode, WalletStatus } from '../../models/Wallet';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { rpc } from '../../lib/gridcoin';
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

    // Per-row UPDATE with status guard rather than the previous
    // bulk-by-target-status UPDATE. The bulk shape had no `WHERE
    // status=oldStatus` clause, so a concurrent cancel that landed
    // between the SELECT above and the UPDATE here would be silently
    // clobbered — e.g. the reconciler decides confirming→funded,
    // cancel flips the row to expired in between, then the bulk
    // UPDATE writes status=funded over the expired row and the
    // merchant gets paid for a wallet the buyer cancelled. Open
    // wallet volume is small per the docstring, so the per-row cost
    // is fine. Only rows whose status actually advances emit a log.
    type Reconciliation = { id: bigint; oldStatus: WalletStatus; newStatus: WalletStatus };
    const transitions: Reconciliation[] = [];
    for (const w of candidates) {
      const target = targetFor(w);
      if (target === w.status) continue;
      transitions.push({ id: w.id, oldStatus: w.status as WalletStatus, newStatus: target });
    }
    if (!transitions.length) return;
    log.info(`Reconciling ${transitions.length} wallet status transition(s)`);

    await Promise.all(transitions.map(async ({ id, oldStatus, newStatus }) => {
      const result = await db
        .updateTable('wallets')
        .set({ status: newStatus, updated_at: now() })
        .where('id', '=', id)
        .where('status', '=', oldStatus)
        .executeTakeFirst();
      if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
        // Lost the race to a concurrent writer (cancel, balance
        // updater, expireWallets). The other writer already produced
        // the correct emit; nothing to do here.
        return;
      }
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(id),
        action: 'status',
        oldStatus,
        newStatus,
      });
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
      //
      // `error` rows are included ONLY when they're still safely
      // refundable AND haven't already burned the expired processor's
      // retry budget:
      //   tx_out IS NULL         — no forward has gone out
      //   refund_tx IS NULL      — no refund has been issued
      //   refund_attempts = 0    — funded-processor catch-flipped row;
      //                             NOT a deferOrError-exhausted
      //                             expired row that already cycled
      //                             through MAX_REFUND_ATTEMPTS.
      //                             Without this clause the exhausted
      //                             rows churn through error→expired
      //                             →error every backoff window,
      //                             flooding webhooks and db_logs.
      // This recovers the dominant funded-processor failure mode
      // (transient sendToAddress throw → status=error, attempts=0)
      // without re-igniting state-machine churn on rows that are
      // genuinely past the human-review boundary.
      .where((eb) => eb.or([
        eb('status', 'in', [WalletStatus.new, WalletStatus.confirming]),
        eb.and([
          eb('status', '=', WalletStatus.error),
          eb('tx_out', 'is', null),
          eb('refund_tx', 'is', null),
          eb('refund_attempts', '=', BigInt(0)),
        ]),
      ]))
      // Never expire a wallet that has a broadcast in flight — the
      // recovery sweep needs to resolve the marker before any other
      // writer touches the row.
      .where('pending_broadcast', 'is', null)
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

    // Per-row UPDATE with status guard — same reason as
    // findFundedWallets: between the SELECT and the UPDATE, a
    // concurrent balance-updater promotion (confirming→funded) or a
    // cancel could legitimately advance the row, and a bulk UPDATE
    // here without a status guard would clobber that advance back to
    // expired. The status guard makes the UPDATE a no-op on the
    // raced rows; only rows that actually transitioned emit a log.
    await Promise.all(expired.map(async (wallet) => {
      const result = await db
        .updateTable('wallets')
        .set({ status: WalletStatus.expired, updated_at: now() })
        .where('id', '=', wallet.id)
        .where('status', '=', wallet.status)
        .executeTakeFirst();
      if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
        return;
      }
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'status',
        oldStatus: wallet.status,
        newStatus: WalletStatus.expired,
      });
    }));
  }

  /**
   * Minimum block-confirmation depth across the indexed incoming
   * deposits for `walletId`. Powers the integrator-facing
   * "N of M confirmations" UI, so it only fires when the caller
   * actually needs it (status === confirming). Returns null when
   *   - nothing's been indexed yet (deposit observed but
   *     IncomingTxIndexerService hasn't run since), or
   *   - every getTransaction RPC failed (daemon flaky) — in which
   *     case the integrator falls back to the generic copy rather
   *     than showing a misleading depth.
   * Negative-confirmation rows (conflicted by reorg) are filtered
   * out — they don't contribute to settlement and would otherwise
   * make the min lie.
   */
  public async getMinConfirmations(walletId: number): Promise<number | null> {
    // Cap fan-out to the N most recent deposits. A confirming wallet
    // only displays "N of M confirmations" — the minimum depth is
    // dominated by the latest tx (older deposits have already cleared
    // the threshold or are within a few blocks of each other), so
    // sampling the recent slice is a faithful approximation. Without
    // this cap, an attacker dust-spamming a confirming address could
    // multiply RPC load: each integrator poll fans out one
    // getTransaction call per indexed tx, sharing the same breaker as
    // the indexer/processors.
    //
    // The whole function returns null on ANY failure — DB or RPC —
    // so the integrator's wallet GET keeps returning 200 with the
    // wallet body and just omits confirmations/confirmationsRequired,
    // matching the docstring's graceful-fallback contract.
    let rows: { txid: string }[];
    try {
      rows = await db
        .selectFrom('incoming_txs')
        .select('txid')
        .where('wallet_id', '=', BigInt(walletId))
        .orderBy('observed_at', 'desc')
        .limit(config.MAX_CONFIRMATION_SAMPLE)
        .execute();
    } catch (e) {
      log.warn(`getMinConfirmations: incoming_txs SELECT failed for wallet ${walletId}: ${e}`);
      return null;
    }
    if (!rows.length) return null;
    const depths = await Promise.all(rows.map(async (row) => {
      try {
        const tx = await rpc.getTransaction(row.txid);
        return tx.confirmations;
      } catch (e) {
        log.warn(`getMinConfirmations: getTransaction(${row.txid}) failed: ${e}`);
        return null;
      }
    }));
    const valid = depths.filter((d): d is number => d !== null && d >= 0);
    if (!valid.length) return null;
    return Math.min(...valid);
  }
}

export const WalletsService = new WalletsServiceClass();
