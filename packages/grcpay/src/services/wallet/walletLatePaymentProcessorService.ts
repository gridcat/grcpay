import { WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findSenderAddress } from './senderLookup';
import { canRetryRefund } from '../../lib/refundBackoff';
import { grc2halford, halford2grc, MIN_FEE_HALFORD as minFeeHalford } from '../../lib/nomination';
import { TimeoutError } from '../../lib/withTimeout';
import type { WalletRow } from '../../lib/database';

/**
 * Catches GRC sent to a wallet that already settled — the stale
 * checkout-page case. Scans terminal wallets (`processed`, `refunded`,
 * `norefund`) whose `updated_at` is within `LATE_PAYMENT_WINDOW`
 * (default 7 days, past which any stale browser session is assumed
 * gone) and refunds any balance delta to the latest sender. `error`
 * is skipped intentionally — those are parked for operator review.
 */
export class WalletLatePaymentProcessorServiceClass {
  constructor(
    private grcRpc = rpc,
  ) {}

  public async processLatePayments(): Promise<void> {
    log.info('Check for late payments on terminal wallets');

    try {
      await this.grcRpc.setTXfee(config.MIN_FEE);
    } catch (e) {
      log.error(`Failed to set tx fee: ${e}`);
      return;
    }

    const cutoffIso = new Date(Date.now() - config.LATE_PAYMENT_WINDOW * 1000).toISOString();
    const candidates = await db
      .selectFrom('wallets')
      .selectAll()
      .where('status', 'in', [
        WalletStatus.processed,
        WalletStatus.refunded,
        WalletStatus.norefund,
      ])
      .where('updated_at', '>=', cutoffIso)
      .execute();

    if (!candidates.length) return;
    log.info(`${candidates.length} terminal wallet(s) to scan for late payments`);

    for (const wallet of candidates) {
      await this.processOne(wallet);
    }
  }

  private async processOne(wallet: WalletRow): Promise<void> {
    const attempts = Number(wallet.refund_attempts);
    if (
      attempts > 0
      && !canRetryRefund(attempts, new Date(wallet.updated_at))
    ) {
      log.info(
        `Skipping late-payment retry on ${wallet.address} — backoff window not elapsed `
        + `(attempts=${attempts})`,
      );
      return;
    }

    let balanceGrc: number;
    try {
      // Confirmed balance only (MIN_CONFIRMATIONS) — matching the funded
      // and expired paths. The daemon default (minconf=1) would let a
      // single-confirmation, still-reorg-able late payment trigger a
      // refund out of the pooled hot wallet.
      balanceGrc = await this.grcRpc.getReceivedByAddress(
        wallet.address,
        config.MIN_CONFIRMATIONS,
      );
    } catch (e) {
      log.warn(`Failed to fetch balance for ${wallet.address}: ${e}`);
      return;
    }

    const balanceHalford = grc2halford(balanceGrc);
    const delta = balanceHalford - wallet.amount_recieved;
    if (delta <= BigInt(0)) {
      return;
    }
    log.info(
      `Late payment detected on ${wallet.address}: ${delta} halford over previously `
      + `recorded ${wallet.amount_recieved}`,
    );

    // Dust — bump amount_recieved so we stop re-detecting it; merchant
    // implicitly absorbs the tip.
    if (delta <= minFeeHalford) {
      await db
        .updateTable('wallets')
        .set({ amount_recieved: balanceHalford, updated_at: now() })
        .where('id', '=', wallet.id)
        .execute();
      log.info(
        `Late payment on ${wallet.address} is ${delta} halford — smaller than `
        + 'the network fee, absorbing as tip.',
      );
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'late_dust',
        newStatus: String(delta),
      });
      return;
    }

    const sender = await findSenderAddress(this.grcRpc, wallet.address, config.MIN_CONFIRMATIONS);
    if (!sender) {
      // No sender → bump amount_recieved so we stop spinning on the
      // same delta. Funds stay in the hot wallet for manual sweep.
      await db
        .updateTable('wallets')
        .set({ amount_recieved: balanceHalford, updated_at: now() })
        .where('id', '=', wallet.id)
        .execute();
      log.warn(
        `Late payment on ${wallet.address} cannot be refunded: sender address `
        + 'could not be determined. Funds left in hot wallet.',
      );
      return;
    }

    const refundHalford = delta - minFeeHalford;
    const refundGrc = halford2grc(refundHalford).toNumber();

    // SIGKILL-SAFETY: pre-broadcast intent marker. Without it, a
    // crash between sendToAddress returning and the persist UPDATE
    // would leave amount_recieved unchanged on disk; next tick re-
    // detects the same delta and re-refunds the sender.
    const intentMarker = `late_refund:${wallet.id}:${sender}:${Date.now()}`;
    // Status filter mirrors the other broadcast sites — pattern
    // divergence here was technically harmless today (all candidate
    // statuses are terminal and nothing flips them back yet) but the
    // moment a future feature lets an operator flip a terminal row
    // back to expired, the late processor and expired processor
    // would both broadcast refunds against the same wallet from their
    // independent schedules.
    const claim = await db
      .updateTable('wallets')
      .set({ pending_broadcast: intentMarker, updated_at: now() })
      .where('id', '=', wallet.id)
      .where('pending_broadcast', 'is', null)
      .where('status', 'in', [
        WalletStatus.processed,
        WalletStatus.refunded,
        WalletStatus.norefund,
      ])
      .executeTakeFirst();
    if (!claim.numUpdatedRows || Number(claim.numUpdatedRows) === 0) {
      log.warn(
        `Late-payment refund could not claim broadcast intent for ${wallet.address} `
        + '— concurrent writer.',
      );
      return;
    }

    // Split try/catch: broadcast failures are safe to retry; DB-write
    // failures AFTER a successful broadcast must NOT retry (would re-
    // detect the same delta and double-refund the sender).
    let tx: string;
    try {
      tx = await this.grcRpc.sendToAddress(sender, refundGrc);
    } catch (e) {
      // Timeout-after-commit: daemon may have committed before the
      // RPC reply dropped. Leave the marker for operator
      // reconciliation; the next tick's claim filter excludes the
      // row, preventing a duplicate refund broadcast.
      if (e instanceof TimeoutError) {
        log.error(
          `CRITICAL: late-payment sendToAddress to ${sender} for `
          + `${wallet.address} timed out — daemon may have committed. `
          + `Marker ${intentMarker} left in place for operator reconciliation.`,
        );
        return;
      }
      // Pre-commit failure — clear marker so the next tick can retry
      // under the existing attempts/backoff state.
      try {
        await db
          .updateTable('wallets')
          .set({ pending_broadcast: null, updated_at: now() })
          .where('id', '=', wallet.id)
          .where('pending_broadcast', '=', intentMarker)
          .execute();
      } catch (e2) {
        log.error(
          `Failed to clear marker for ${wallet.address} after pre-commit `
          + `late-payment failure: ${e2}. Marker ${intentMarker} stranded.`,
        );
      }
      const nextAttempts = attempts + 1;
      log.error(
        `Late refund attempt ${nextAttempts}/${config.MAX_REFUND_ATTEMPTS} failed for `
        + `${wallet.address} (${refundGrc} GRC to ${sender}): ${e}`,
      );

      if (nextAttempts >= config.MAX_REFUND_ATTEMPTS) {
        // Give up: bump amount_recieved so we stop, reset the counter.
        await db
          .updateTable('wallets')
          .set({
            amount_recieved: balanceHalford,
            refund_attempts: BigInt(0),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .execute();
        log.error(
          `Late refund for ${wallet.address} exhausted retries — leaving `
          + 'funds in hot wallet for operator sweep.',
        );
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'late_refund_abandoned',
          newStatus: String(delta),
        });
      } else {
        await db
          .updateTable('wallets')
          .set({ refund_attempts: BigInt(nextAttempts), updated_at: now() })
          .where('id', '=', wallet.id)
          .execute();
      }
      return;
    }

    log.info(
      `Refunded late payment of ${refundGrc} GRC to ${sender} for wallet `
      + `${wallet.address} (tx ${tx}).`,
    );
    const newRefundTotal = (wallet.refund_amount ?? BigInt(0)) + refundHalford;

    // CRASH-SAFETY: in-process retry; on permanent failure HALT THE
    // PROCESS rather than letting the next tick re-detect the same
    // delta and re-broadcast. The refund is real on-chain; the chain
    // is the authoritative record an operator can reconstruct from.
    let persisted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let updateError: unknown = null;
      let matchedRow = false;
      try {
        // executeTakeFirst + numUpdatedRows check so a silent 0-row
        // match (marker cleared between sendToAddress returning and
        // this UPDATE — no path does this today, but defense-in-depth)
        // doesn't get reported as success and re-broadcast next tick.
        const result = await db
          .updateTable('wallets')
          .set({
            amount_recieved: balanceHalford,
            refund_amount: newRefundTotal,
            // Preserve any prior refund_tx; the late refund txid lands
            // in db_logs only.
            refund_tx: wallet.refund_tx ?? tx,
            refund_attempts: BigInt(0),
            pending_broadcast: null,
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .where('pending_broadcast', '=', intentMarker)
          .executeTakeFirst();
        matchedRow = !!result.numUpdatedRows && Number(result.numUpdatedRows) > 0;
      } catch (e2) {
        updateError = e2;
      }
      if (matchedRow) {
        persisted = true;
        break;
      }
      if (updateError) {
        log.error(
          `Late-payment refund persist attempt ${attempt + 1}/3 failed for `
          + `${wallet.address} (tx ${tx}): ${updateError}`,
        );
      } else {
        log.error(
          `Late-payment refund persist matched 0 rows for ${wallet.address} `
          + `(tx ${tx}, marker ${intentMarker}) — marker was cleared `
          + 'externally between broadcast and persist. Treating as persist failure.',
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 50 * (attempt + 1)); });
    }
    if (!persisted) {
      log.error(
        'CRITICAL: late-payment refund persist failed permanently for '
        + `${wallet.address}. tx ${tx} is on-chain. Halting process `
        + 'to prevent a double-refund on next tick. Operator: inspect '
        + `the chain and set amount_recieved=${balanceHalford}, `
        + `refund_amount=${newRefundTotal} on this row before restart.`,
      );
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }

    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: Number(wallet.id),
      action: 'late_refund',
      newStatus: tx,
    });
  }
}

export const WalletLatePaymentProcessorService = new WalletLatePaymentProcessorServiceClass();
