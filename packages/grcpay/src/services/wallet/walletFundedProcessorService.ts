import { wallets } from '@prisma/client';
import { Wallet, WalletMode, WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findSenderAddress } from './senderLookup';
import { canRetryRefund } from '../../lib/refundBackoff';

// MIN_FEE in halford so overpayment comparisons stay in BigInt and
// don't round-trip through floating point.
const minFeeHalford = BigInt(Math.round(config.MIN_FEE * config.HALFORD));

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
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  public async processFunded(): Promise<void> {
    log.info('Process funded wallets');

    // Fast path: if there are no funded wallets at all, skip every RPC
    // call. Without this guard the processor would still hit setTXfee
    // on every tick — a bug that previously wedged the job loop for
    // over an hour when the wallet daemon's RPC got stuck, because the
    // loop entered this method, blocked on setTXfee, and never returned
    // even though there was literally nothing to process.
    const fundedCount = await this.wallet.model.count({
      where: { status: WalletStatus.funded, mode: WalletMode.checkout },
    });
    if (fundedCount === 0) {
      return;
    }

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

    await this.processWithoutRecipient();
    await this.processWithRecipient();
  }

  private shouldDeferForBackoff(wallet: wallets): boolean {
    if (wallet.refund_attempts === 0) return false;
    if (canRetryRefund(wallet.refund_attempts, wallet.updated_at)) return false;
    log.info(
      `Skipping refund retry on ${wallet.address} — backoff window not elapsed `
      + `(attempts=${wallet.refund_attempts})`,
    );
    return true;
  }

  private async refundOverpaymentIfAny(wallet: wallets): Promise<RefundResult> {
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
        walletId: wallet.id,
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
      const attempts = wallet.refund_attempts + 1;
      log.error(
        `Refund attempt ${attempts}/${config.MAX_REFUND_ATTEMPTS} failed for `
        + `${wallet.address} (${refundAmountGrc} GRC to ${sender}): ${e}`,
      );
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
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

  private async processWithoutRecipient(): Promise<void> {
    log.info('Process funded without recipients');
    const fundedWallets = await this.wallet.model.findMany({
      where: {
        status: WalletStatus.funded,
        recipient: null,
        // Defensive: settlement math assumes checkout semantics.
        // Keep a second filter here so a future non-checkout wallet
        // that somehow reached `funded` can't trigger settlement.
        mode: WalletMode.checkout,
      },
    });
    if (!fundedWallets.length) {
      return;
    }
    log.info(`${fundedWallets.length} wallet(s) to be processed`);
    for (const wallet of fundedWallets) {
      if (this.shouldDeferForBackoff(wallet)) continue;

      const refund = await this.refundOverpaymentIfAny(wallet);

      if (refund.outcome === 'retry') {
        await this.wallet.model.update({
          where: { id: wallet.id },
          data: { refund_attempts: wallet.refund_attempts + 1 },
        });
        continue;
      }
      if (refund.outcome === 'abandoned') {
        log.warn(
          `Overpayment refund for ${wallet.address} exhausted retries — processing `
          + 'wallet anyway so the merchant sweep is not blocked.',
        );
      }

      await this.wallet.model.update({
        where: { id: wallet.id },
        data: {
          status: WalletStatus.processed,
          refund_tx: refund.txid,
          refund_amount: refund.txid ? refund.refundedHalford : null,
          refund_attempts: 0,
        },
      });
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'status',
        oldStatus: WalletStatus.funded,
        newStatus: WalletStatus.processed,
      });
    }
  }

  private async processWithRecipient(): Promise<void> {
    log.info('Process funded wallets with recipient');
    const fundedWallets = await this.wallet.model.findMany({
      where: {
        status: WalletStatus.funded,
        recipient: {
          not: null,
        },
        mode: WalletMode.checkout,
      },
    });
    for (let i = 0; i < fundedWallets.length; i++) {
      const wallet = fundedWallets[i];

      if (this.shouldDeferForBackoff(wallet)) continue;

      const refund = await this.refundOverpaymentIfAny(wallet);

      if (refund.outcome === 'retry') {
        await this.wallet.model.update({
          where: { id: wallet.id },
          data: { refund_attempts: wallet.refund_attempts + 1 },
        });
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
        await this.wallet.model.update({
          where: {
            id: wallet.id,
          },
          data: {
            status: WalletStatus.processed,
            tx_out: tx,
            refund_tx: refund.txid,
            refund_amount: refund.txid ? refund.refundedHalford : null,
            refund_attempts: 0,
          },
        });
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'status',
          oldStatus: WalletStatus.funded,
          newStatus: WalletStatus.processed,
        });
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'tx_out',
          oldStatus: '',
          newStatus: tx,
        });
      } catch (e) {
        log.error(`Failed to process funded wallet ${wallet.address}: ${e}`);
        await this.wallet.model.update({
          where: { id: wallet.id },
          data: { status: WalletStatus.error },
        });
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'status',
          oldStatus: WalletStatus.funded,
          newStatus: WalletStatus.error,
        });
      }
    }
  }
}

export const WalletFundedProcessorService = new WalletFundedProcessorServiceClass();
