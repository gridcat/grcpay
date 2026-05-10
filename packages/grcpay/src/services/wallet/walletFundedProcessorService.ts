import { WalletMode, WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findSenderAddress } from './senderLookup';
import { canRetryRefund } from '../../lib/refundBackoff';
import { MIN_FEE_HALFORD as minFeeHalford } from '../../lib/nomination';
import type { WalletRow } from '../../lib/database';

// outcome:
//   none      — no refund needed (exact, dust, sender unknown). Forward as normal.
//   success   — refund broadcast. Forward `required - fee`.
//   retry     — RPC threw, attempts not yet exhausted. Caller bumps counter and skips.
//   abandoned — RPC threw past MAX_REFUND_ATTEMPTS. Caller forwards everything so
//               the merchant payout is never permanently blocked.
interface RefundResult {
  outcome: 'none' | 'success' | 'retry' | 'abandoned';
  txid: string | null;
  // Total halford consumed from the hot wallet by the refund tx
  // (output + fee, == overpayment on success). Caller subtracts this
  // from amount_recieved before the forward math so the hot wallet
  // drains cleanly regardless of which branch ran.
  debitedHalford: bigint;
  refundedHalford: bigint;
}

export class WalletFundedProcessorServiceClass {
  constructor(
    private grcRpc = rpc,
  ) {}

  public async processFunded(): Promise<void> {
    log.info('Process funded wallets');

    // Single SELECT covers both branches; we partition by recipient
    // in JS. Critically, this also gates the setTXfee call below — an
    // empty result means we skip the RPC entirely. Without that gate
    // the processor would still hit setTXfee on every tick, which
    // previously wedged the job loop for over an hour when the wallet
    // daemon's RPC got stuck (loop entered, blocked on setTXfee,
    // never returned even though there was literally nothing to do).
    const funded = await this.loadFunded();
    if (!funded.length) return;

    const withRecipient = funded.filter((w) => w.recipient !== null);
    const withoutRecipient = funded.filter((w) => w.recipient === null);

    // INVARIANT: setTXfee is daemon-wide and persistent. The amount
    // math below assumes MIN_FEE for the duration of this cycle — if
    // anything else (cron, another service, manual RPC call) changes
    // it, the forward/refund amounts will drift. See the hot/cold
    // wallet pattern in the self-hosting docs.
    try {
      await this.grcRpc.setTXfee(config.MIN_FEE);
    } catch (e) {
      log.error(`Failed to set tx fee: ${e}`);
      return;
    }

    await this.processWithoutRecipient(withoutRecipient);
    await this.processWithRecipient(withRecipient);
  }

  private shouldDeferForBackoff(wallet: WalletRow): boolean {
    const attempts = Number(wallet.refund_attempts);
    if (attempts === 0) return false;
    if (canRetryRefund(attempts, new Date(wallet.updated_at))) return false;
    log.info(
      `Skipping refund retry on ${wallet.address} — backoff window not elapsed `
      + `(attempts=${attempts})`,
    );
    return true;
  }

  private async refundOverpaymentIfAny(wallet: WalletRow): Promise<RefundResult> {
    const noRefund: RefundResult = {
      outcome: 'none',
      txid: null,
      debitedHalford: BigInt(0),
      refundedHalford: BigInt(0),
    };
    const overpayment = wallet.amount_recieved - wallet.amount_required;
    if (overpayment <= BigInt(0)) {
      return noRefund;
    }
    if (overpayment <= minFeeHalford) {
      log.info(
        `Overpayment on ${wallet.address} is ${overpayment} halford — smaller than `
        + 'the network fee, skipping refund (merchant will receive the tip).',
      );
      return noRefund;
    }

    const sender = await findSenderAddress(this.grcRpc, wallet.address);
    if (!sender) {
      log.warn(
        `Overpayment on ${wallet.address} cannot be refunded: sender address `
        + 'could not be determined from transaction history.',
      );
      return noRefund;
    }

    const refundAmountGrc = Number(overpayment) / config.HALFORD - config.MIN_FEE;

    try {
      const tx = await this.grcRpc.sendToAddress(sender, refundAmountGrc);
      log.info(
        `Refunded overpayment of ${refundAmountGrc} GRC to ${sender} for wallet `
        + `${wallet.address} (tx ${tx}).`,
      );
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'overpayment_refund',
        newStatus: tx,
      });
      // The refund tx consumed refundAmountGrc at the output plus
      // MIN_FEE at the network fee → total debit == the original
      // overpayment in halford units. The amount the customer
      // actually received is overpayment − fee.
      return {
        outcome: 'success',
        txid: tx,
        debitedHalford: overpayment,
        refundedHalford: overpayment - minFeeHalford,
      };
    } catch (e) {
      const attempts = Number(wallet.refund_attempts) + 1;
      log.error(
        `Refund attempt ${attempts}/${config.MAX_REFUND_ATTEMPTS} failed for `
        + `${wallet.address} (${refundAmountGrc} GRC to ${sender}): ${e}`,
      );
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'overpayment_refund_failed',
        newStatus: `attempt ${attempts}/${config.MAX_REFUND_ATTEMPTS}`,
      });
      if (attempts >= config.MAX_REFUND_ATTEMPTS) {
        return {
          outcome: 'abandoned',
          txid: null,
          debitedHalford: BigInt(0),
          refundedHalford: BigInt(0),
        };
      }
      return {
        outcome: 'retry',
        txid: null,
        debitedHalford: BigInt(0),
        refundedHalford: BigInt(0),
      };
    }
  }

  private async loadFunded(): Promise<WalletRow[]> {
    return db
      .selectFrom('wallets')
      .selectAll()
      .where('status', '=', WalletStatus.funded)
      // Defensive: settlement math assumes checkout semantics. Keep
      // the mode filter explicit so a future non-checkout wallet that
      // somehow reached `funded` can't trigger settlement.
      .where('mode', '=', WalletMode.checkout)
      .execute();
  }

  private async processWithoutRecipient(fundedWallets: WalletRow[]): Promise<void> {
    log.info('Process funded without recipients');
    if (!fundedWallets.length) return;
    log.info(`${fundedWallets.length} wallet(s) to be processed`);
    for (const wallet of fundedWallets) {
      if (this.shouldDeferForBackoff(wallet)) continue;

      const refund = await this.refundOverpaymentIfAny(wallet);

      if (refund.outcome === 'retry') {
        await db
          .updateTable('wallets')
          .set({
            refund_attempts: BigInt(Number(wallet.refund_attempts) + 1),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .execute();
        continue;
      }
      if (refund.outcome === 'abandoned') {
        log.warn(
          `Overpayment refund for ${wallet.address} exhausted retries — processing `
          + 'wallet anyway so the merchant sweep is not blocked.',
        );
      }

      await db
        .updateTable('wallets')
        .set({
          status: WalletStatus.processed,
          refund_tx: refund.txid,
          refund_amount: refund.txid ? refund.refundedHalford : null,
          refund_attempts: BigInt(0),
          updated_at: now(),
        })
        .where('id', '=', wallet.id)
        .execute();
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: Number(wallet.id),
        action: 'status',
        oldStatus: WalletStatus.funded,
        newStatus: WalletStatus.processed,
      });
    }
  }

  private async processWithRecipient(fundedWallets: WalletRow[]): Promise<void> {
    log.info('Process funded wallets with recipient');
    for (const wallet of fundedWallets) {
      if (this.shouldDeferForBackoff(wallet)) continue;

      const refund = await this.refundOverpaymentIfAny(wallet);

      if (refund.outcome === 'retry') {
        await db
          .updateTable('wallets')
          .set({
            refund_attempts: BigInt(Number(wallet.refund_attempts) + 1),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .execute();
        continue;
      }
      if (refund.outcome === 'abandoned') {
        log.warn(
          `Overpayment refund for ${wallet.address} exhausted retries — forwarding `
          + 'full balance to merchant so the payout is not blocked.',
        );
      }

      try {
        // Forward math drains the hot wallet cleanly in either branch:
        //   success   → remaining = required, forward = required - fee
        //   none/abandoned → remaining = received, forward = received - fee
        const remainingHalford = wallet.amount_recieved - refund.debitedHalford;
        const forwardAmountGrc = Number(remainingHalford - minFeeHalford) / config.HALFORD;
        const tx = await this.grcRpc.sendToAddress(
          wallet.recipient!,
          forwardAmountGrc,
          wallet.address,
        );
        await db
          .updateTable('wallets')
          .set({
            status: WalletStatus.processed,
            tx_out: tx,
            refund_tx: refund.txid,
            refund_amount: refund.txid ? refund.refundedHalford : null,
            refund_attempts: BigInt(0),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .execute();
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'status',
          oldStatus: WalletStatus.funded,
          newStatus: WalletStatus.processed,
        });
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'tx_out',
          oldStatus: '',
          newStatus: tx,
        });
      } catch (e) {
        log.error(`Failed to process funded wallet ${wallet.address}: ${e}`);
        await db
          .updateTable('wallets')
          .set({ status: WalletStatus.error, updated_at: now() })
          .where('id', '=', wallet.id)
          .execute();
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'status',
          oldStatus: WalletStatus.funded,
          newStatus: WalletStatus.error,
        });
      }
    }
  }
}

export const WalletFundedProcessorService = new WalletFundedProcessorServiceClass();
