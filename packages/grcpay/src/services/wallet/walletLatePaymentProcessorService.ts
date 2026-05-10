import { WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findSenderAddress } from './senderLookup';
import { canRetryRefund } from '../../lib/refundBackoff';
import { grc2halford, MIN_FEE_HALFORD as minFeeHalford } from '../../lib/nomination';
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
      balanceGrc = await this.grcRpc.getReceivedByAddress(wallet.address);
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

    const sender = await findSenderAddress(this.grcRpc, wallet.address);
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
    const refundGrc = Number(refundHalford) / config.HALFORD;

    try {
      const tx = await this.grcRpc.sendToAddress(sender, refundGrc);
      log.info(
        `Refunded late payment of ${refundGrc} GRC to ${sender} for wallet `
        + `${wallet.address} (tx ${tx}).`,
      );
      const newRefundTotal = (wallet.refund_amount ?? BigInt(0)) + refundHalford;
      await db
        .updateTable('wallets')
        .set({
          amount_recieved: balanceHalford,
          refund_amount: newRefundTotal,
          // Preserve any prior refund_tx; the late refund txid lands
          // in db_logs only.
          refund_tx: wallet.refund_tx ?? tx,
          refund_attempts: BigInt(0),
          updated_at: now(),
        })
        .where('id', '=', wallet.id)
        .execute();
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'late_refund',
        newStatus: tx,
      });
    } catch (e) {
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
    }
  }
}

export const WalletLatePaymentProcessorService = new WalletLatePaymentProcessorServiceClass();
