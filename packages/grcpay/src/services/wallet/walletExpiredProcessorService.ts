import { WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findAllSenders } from './senderLookup';
import { MIN_FEE_HALFORD as minFeeHalford } from '../../lib/nomination';

export class WalletExpiredProcessorServiceClass {
  constructor(
    private grcRpc = rpc,
  ) {}

  public async processExpired(): Promise<void> {
    log.info('Process expired wallets');
    // Process those with empty balance first
    await this.processWithZeroBalance();
    await this.processWithBalance();
  }

  private async processWithZeroBalance(): Promise<void> {
    log.info('Process expired empty wallets');
    const expiredEmptyWallets = await db
      .selectFrom('wallets')
      .select(['id'])
      .where('status', '=', WalletStatus.expired)
      .where('amount_recieved', '=', BigInt(0))
      .execute();

    if (!expiredEmptyWallets.length) return;
    log.info(`${expiredEmptyWallets.length} wallet(s) to be expired`);

    await db
      .updateTable('wallets')
      .set({ status: WalletStatus.norefund, updated_at: now() })
      .where('id', 'in', expiredEmptyWallets.map((w) => w.id))
      .execute();

    expiredEmptyWallets.forEach((wallet) => {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'status',
        oldStatus: WalletStatus.expired,
        newStatus: WalletStatus.norefund,
      });
    });
  }

  private async processWithBalance(): Promise<void> {
    log.info('Process expired wallets with non-empty balance');

    // See the matching invariant in walletFundedProcessorService. The
    // expired processor runs right after the funded one in the same job
    // loop cycle, so the fee is almost certainly still set — but we set
    // it again defensively here in case someone reorders the pipeline.
    try {
      await this.grcRpc.setTXfee(config.MIN_FEE);
    } catch (e) {
      log.error(`Failed to set tx fee: ${e}`);
      return;
    }

    const expiredWallets = await db
      .selectFrom('wallets')
      .selectAll()
      .where('status', '=', WalletStatus.expired)
      .where('amount_recieved', '>', BigInt(0))
      .execute();

    for (const wallet of expiredWallets) {
      log.info(`Attempting refund for expired wallet ${wallet.address}`);

      // Walk the full sender list, not just the latest — if multiple
      // customers contributed to a wallet that never reached its
      // target, each one gets back what they sent (minus their own
      // per-tx fee).
      const senders = await findAllSenders(this.grcRpc, wallet.address);
      if (!senders.length) {
        log.warn(
          `Cannot determine any senders for wallet ${wallet.address}, `
          + 'setting to error for manual review',
        );
        await db
          .updateTable('wallets')
          .set({ status: WalletStatus.error, updated_at: now() })
          .where('id', '=', wallet.id)
          .execute();
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'status',
          oldStatus: WalletStatus.expired,
          newStatus: WalletStatus.error,
        });
        continue;
      }

      // Refund each sender their own contribution, minus the per-tx fee.
      // Skip senders whose share is smaller than the fee — refunding
      // them would be net-negative.
      let firstRefundTx: string | null = null;
      let totalRefundedHalford = BigInt(0);
      let anyFailed = false;

      for (const sender of senders) {
        if (sender.amountHalford <= minFeeHalford) {
          log.info(
            `Skipping dust refund of ${sender.amountHalford} halford to `
            + `${sender.address} for wallet ${wallet.address} `
            + '(sender\'s contribution is smaller than the network fee).',
          );
          continue;
        }
        const refundHalford = sender.amountHalford - minFeeHalford;
        const refundAmountGrc = Number(refundHalford) / config.HALFORD;
        try {
          const tx = await this.grcRpc.sendToAddress(sender.address, refundAmountGrc);
          totalRefundedHalford += refundHalford;
          if (!firstRefundTx) firstRefundTx = tx;
          log.info(
            `Refunded ${refundAmountGrc} GRC to ${sender.address} for wallet `
            + `${wallet.address} (tx ${tx}).`,
          );
          getEventEmitter<DbLogMessage>().emit('log', {
            walletId: Number(wallet.id),
            action: 'expired_refund',
            newStatus: tx,
          });
        } catch (e) {
          log.error(
            `Failed to refund ${refundAmountGrc} GRC to ${sender.address} `
            + `for wallet ${wallet.address}: ${e}`,
          );
          anyFailed = true;
        }
      }

      // Decide the final status:
      //   refunded  — at least one refund went out, none failed
      //   error     — a refund tx threw somewhere (fully failed or
      //               partial success; either way needs attention)
      //   norefund  — nothing was even attempted because every sender
      //               was below the dust threshold
      let finalStatus: WalletStatus;
      if (firstRefundTx && !anyFailed) {
        finalStatus = WalletStatus.refunded;
      } else if (anyFailed) {
        finalStatus = WalletStatus.error;
      } else {
        finalStatus = WalletStatus.norefund;
      }

      if (firstRefundTx) {
        await db
          .updateTable('wallets')
          .set({
            status: finalStatus,
            tx_out: firstRefundTx,
            refund_amount: totalRefundedHalford,
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .execute();
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'tx_out',
          oldStatus: '',
          newStatus: firstRefundTx,
        });
      } else {
        // No refund tx went out. Either all senders were dust
        // (norefund) or every attempt failed (error).
        await db
          .updateTable('wallets')
          .set({ status: finalStatus, updated_at: now() })
          .where('id', '=', wallet.id)
          .execute();
      }
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'status',
        oldStatus: WalletStatus.expired,
        newStatus: finalStatus,
      });
    }
  }
}

export const WalletExpiredProcessorService = new WalletExpiredProcessorServiceClass();
