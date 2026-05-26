/* eslint-disable max-classes-per-file */
import { Wallet, WalletStatus } from '../../models/Wallet';
import { db, now } from '../../lib/db';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';

const ZERO = BigInt(0);

export class WalletCancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletCancelError';
  }
}

// Pre-launch decision: cancellation flips ANY pre-terminal wallet to
// `expired`, regardless of whether the customer has started paying.
// The existing expired-with-balance processor returns any in-flight
// funds to the sender on the next sweep tick (~JOBS_INTERVAL); for
// the no-funds case the empty-expired branch marks the row `norefund`
// in the same cycle. So the merchant intent ("abandon this wallet")
// resolves to "return whatever's there to the buyer" — same mental
// model Stripe / Square use for cancelling an unfulfilled checkout.
//
// Why this is safe across statuses now:
//   * tx_out IS NULL ensures the funds haven't been forwarded — that's
//     the only true "too late" boundary.
//   * The status filter excludes already-terminal rows (refunded /
//     norefund / expired / error / processed) so a double-cancel
//     doesn't churn the row through expired again or race with the
//     existing refund handler. `processed` matters for no-recipient
//     wallets, which settle without ever writing tx_out — without the
//     exclusion they'd still match the tx_out IS NULL guard and a
//     stray DELETE would refund the buyer from money the merchant
//     already collected.
//
// The atomic UPDATE-WHERE is load-bearing: without it, a cancel call
// that arrives at the same job-loop tick as the funded-processor's
// forward attempt could clobber the post-forward state. The funded
// processor's settlement UPDATE has a matching status='funded' AND
// tx_out IS NULL guard so this race resolves cleanly (see
// walletFundedProcessorService.processWithRecipient).
const TERMINAL_OR_SETTLED: WalletStatus[] = [
  WalletStatus.expired,
  WalletStatus.refunded,
  WalletStatus.norefund,
  WalletStatus.error,
  WalletStatus.processed,
];

export class WalletCancelServiceClass {
  public async cancelWallet(wallet: Wallet): Promise<void> {
    log.info(`Merchant-initiated cancellation of wallet ${wallet.address}`);

    // Re-read the row inside the cancel flow so the emitted oldStatus
    // matches the actual pre-cancel status, not the (potentially
    // stale) value loaded by the auth middleware. Between middleware
    // and here, the balance updater can have promoted new→confirming
    // or confirming→funded; emitting the stale status would publish
    // an impossible transition (e.g. confirming→expired when the row
    // was actually funded).
    const fresh = await db
      .selectFrom('wallets')
      .select(['status', 'tx_out', 'refund_tx', 'pending_broadcast'])
      .where('id', '=', BigInt(wallet.id!))
      .executeTakeFirst();

    if (!fresh) {
      throw new WalletCancelError(
        `Wallet ${wallet.address} not found`,
      );
    }
    if (fresh.tx_out !== null || TERMINAL_OR_SETTLED.includes(fresh.status as WalletStatus)) {
      throw new WalletCancelError(
        `Wallet ${wallet.address} is already settled or in a terminal state `
        + `(status=${fresh.status}, tx_out=${fresh.tx_out ? 'set' : 'null'}) — nothing to cancel`,
      );
    }
    // Refuse to cancel a wallet with a broadcast in flight. The
    // marker means a sendToAddress is mid-flight (or its result UPDATE
    // crashed) — cancelling now would race the broadcast and could
    // result in the merchant being paid AND the buyer being refunded
    // (or vice versa). The integrator should retry after the broadcast
    // either settles (status flips terminal) or is reconciled by
    // recoverInterruptedSettlements.
    if (fresh.pending_broadcast !== null) {
      throw new WalletCancelError(
        `Wallet ${wallet.address} has a broadcast in flight `
        + `(pending_broadcast=${fresh.pending_broadcast}) — retry after it settles.`,
      );
    }
    // Refuse to cancel when a prior overpayment refund already
    // broadcast (refund_tx set, tx_out still null — the funded
    // processor crashed between refundOverpaymentIfAny's persist and
    // the merchant-forward marker claim). The expired processor's
    // safety park parks rows with refund_tx-but-no-tx_out as `error`
    // to prevent a double-refund, but walletsService.expireWallets
    // can't re-include them for the buyer-refund recovery path (its
    // predicate requires refund_tx IS NULL). Letting cancel flip the
    // row to expired here would strand the buyer's principal as
    // `error`, only releasable via manual DB edits. Refuse with 409
    // so the integrator retries after the next funded-processor tick
    // either completes the forward or parks the wallet itself.
    if (fresh.refund_tx !== null) {
      throw new WalletCancelError(
        `Wallet ${wallet.address} has a prior outbound refund on-chain `
        + `(refund_tx=${fresh.refund_tx}) — retry after the funded `
        + 'processor finishes the settlement.',
      );
    }

    // Reset refund_attempts: a cancel is an explicit state reset, not
    // a continuation of the funded-processor's backoff window. Without
    // this, an expired processor tick that follows could inherit a
    // non-zero attempts counter and stall the buyer's refund under
    // stale backoff math (canRetryRefund uses updated_at, which the
    // cancel UPDATE just refreshed).
    // The marker guard MUST live on the UPDATE too, not only the
    // preflight SELECT above: the SELECT-then-UPDATE window is wide
    // enough for the funded processor's claim to set the marker
    // between them (a TOCTOU race). Without this guard, cancel can
    // succeed with 200 OK while a merchant forward is mid-flight —
    // the persist UPDATE then writes tx_out onto an `expired` row,
    // the expired processor parks it as `error`, the buyer is never
    // refunded, and the merchant has been paid. Adding the marker
    // clause makes cancel cleanly lose the race and surface a 409.
    const result = await db
      .updateTable('wallets')
      .set({
        status: WalletStatus.expired,
        refund_attempts: ZERO,
        updated_at: now(),
      })
      .where('id', '=', BigInt(wallet.id!))
      .where('tx_out', 'is', null)
      .where('status', '=', fresh.status)
      .where('pending_broadcast', 'is', null)
      // Symmetric with the marker guard above: refund_tx being set
      // between the SELECT and this UPDATE means a concurrent funded-
      // processor tick just landed an overpayment refund. The
      // safety-park rules in the expired processor would then strand
      // this row's principal as `error` if we let the cancel through;
      // refuse atomically instead.
      .where('refund_tx', 'is', null)
      .executeTakeFirst();

    if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
      // Race: status changed between the SELECT above and this UPDATE
      // (balance updater, funded processor, or a concurrent cancel).
      // Surface the observed-fresh-status in the 409 so the integrator
      // can tell "too late, money is settling" from "concurrent
      // cancel won".
      throw new WalletCancelError(
        `Wallet ${wallet.address} could not be cancelled — its status changed `
        + `from ${fresh.status} mid-request (concurrent settle or cancel). `
        + 'Re-GET the wallet for the current state.',
      );
    }

    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: wallet.id!,
      action: 'status',
      oldStatus: fresh.status,
      newStatus: WalletStatus.expired,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: wallet.id!,
      action: 'cancelled',
      newStatus: 'merchant',
    });
  }
}

export const WalletCancelService = new WalletCancelServiceClass();
