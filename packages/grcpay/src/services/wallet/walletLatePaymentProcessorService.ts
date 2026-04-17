import { wallets } from '@prisma/client';
import { Wallet, WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findSenderAddress } from './senderLookup';
import { canRetryRefund } from '../../lib/refundBackoff';
import { grc2halford } from '../../lib/nomination';

const minFeeHalford = BigInt(Math.round(config.MIN_FEE * config.HALFORD));

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
    private wallet = new Wallet(),
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

    const cutoff = new Date(Date.now() - config.LATE_PAYMENT_WINDOW * 1000);
    const candidates = await this.wallet.model.findMany({
      select: {
        id: true,
        address: true,
        amount_recieved: true,
        amount_pending: true,
        amount_required: true,
        status: true,
        recipient: true,
        tx_out: true,
        refund_tx: true,
        refund_amount: true,
        refund_attempts: true,
        mode: true,
        lifespan_seconds: true,
        token_hash: true,
        created_at: true,
        updated_at: true,
      },
      where: {
        status: {
          in: [
            WalletStatus.processed,
            WalletStatus.refunded,
            WalletStatus.norefund,
          ],
        },
        updated_at: {
          gte: cutoff,
        },
      },
    });

    if (!candidates.length) {
      return;
    }
    log.info(`${candidates.length} terminal wallet(s) to scan for late payments`);

    for (const wallet of candidates) {
      await this.processOne(wallet);
    }
  }

  private async processOne(wallet: wallets): Promise<void> {
    if (
      wallet.refund_attempts > 0
      && !canRetryRefund(wallet.refund_attempts, wallet.updated_at)
    ) {
      log.info(
        `Skipping late-payment retry on ${wallet.address} — backoff window not elapsed `
        + `(attempts=${wallet.refund_attempts})`,
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
      await this.wallet.model.update({
        where: { id: wallet.id },
        data: { amount_recieved: balanceHalford },
      });
      log.info(
        `Late payment on ${wallet.address} is ${delta} halford — smaller than `
        + 'the network fee, absorbing as tip.',
      );
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'late_dust',
        newStatus: String(delta),
      });
      return;
    }

    const sender = await findSenderAddress(this.grcRpc, wallet.address);
    if (!sender) {
      // No sender → bump amount_recieved so we stop spinning on the
      // same delta. Funds stay in the hot wallet for manual sweep.
      await this.wallet.model.update({
        where: { id: wallet.id },
        data: { amount_recieved: balanceHalford },
      });
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
      await this.wallet.model.update({
        where: { id: wallet.id },
        data: {
          amount_recieved: balanceHalford,
          refund_amount: newRefundTotal,
          // Preserve any prior refund_tx; the late refund txid lands
          // in db_logs only.
          refund_tx: wallet.refund_tx ?? tx,
          refund_attempts: 0,
        },
      });
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'late_refund',
        newStatus: tx,
      });
    } catch (e) {
      const attempts = wallet.refund_attempts + 1;
      log.error(
        `Late refund attempt ${attempts}/${config.MAX_REFUND_ATTEMPTS} failed for `
        + `${wallet.address} (${refundGrc} GRC to ${sender}): ${e}`,
      );

      if (attempts >= config.MAX_REFUND_ATTEMPTS) {
        // Give up: bump amount_recieved so we stop, reset the counter.
        await this.wallet.model.update({
          where: { id: wallet.id },
          data: {
            amount_recieved: balanceHalford,
            refund_attempts: 0,
          },
        });
        log.error(
          `Late refund for ${wallet.address} exhausted retries — leaving `
          + 'funds in hot wallet for operator sweep.',
        );
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'late_refund_abandoned',
          newStatus: String(delta),
        });
      } else {
        await this.wallet.model.update({
          where: { id: wallet.id },
          data: { refund_attempts: attempts },
        });
      }
    }
  }
}

export const WalletLatePaymentProcessorService = new WalletLatePaymentProcessorServiceClass();
