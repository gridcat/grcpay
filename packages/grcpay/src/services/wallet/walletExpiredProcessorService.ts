import { WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { findAllSenders } from './senderLookup';
import { canRetryRefund } from '../../lib/refundBackoff';
import { grc2halford, MIN_FEE_HALFORD as minFeeHalford } from '../../lib/nomination';
import { TimeoutError } from '../../lib/withTimeout';
import type { WalletRow } from '../../lib/database';

const ZERO = BigInt(0);

// Processes wallets that have reached `expired` — either by lifespan
// timeout or a merchant-initiated cancel (DELETE /wallets/:address,
// supported even when the customer has paid: e.g. the merchant
// renegotiated the price and is re-issuing a wallet).
//
// WHY this works off LIVE chain balance, not the cached
// amount_recieved: once a wallet leaves `new`/`confirming`,
// WalletsBalanceUpdater stops touching it, so amount_recieved is
// frozen at whatever it was the instant the wallet expired. If the
// customer's tx was still unconfirmed then, that cached value is 0 and
// would wrongly look "empty". We re-derive the balance every tick.
export class WalletExpiredProcessorServiceClass {
  constructor(
    private grcRpc = rpc,
  ) {}

  public async processExpired(): Promise<void> {
    log.info('Process expired wallets');

    const expiredWallets = await db
      .selectFrom('wallets')
      .selectAll()
      .where('status', '=', WalletStatus.expired)
      // Exclude wallets with a broadcast in flight or a stalled
      // marker from a prior crash. processExpired walking them would
      // waste getReceivedByAddress + findAllSenders RPC budget every
      // tick only for the batch-marker claim to fail and the row to
      // churn through deferOrError → setTerminal(error). The marker
      // also gates against re-broadcasting any sender whose previous
      // sendToAddress may have committed before the RPC reply was
      // dropped (TimeoutError path).
      .where('pending_broadcast', 'is', null)
      .execute();
    if (!expiredWallets.length) return;

    // See the matching invariant in walletFundedProcessorService. The
    // expired processor runs right after the funded one in the same
    // job loop cycle, so the fee is almost certainly still set — but
    // we set it again defensively in case someone reorders the
    // pipeline. Gated behind a non-empty set so a stuck daemon can't
    // wedge the loop on setTXfee when there's nothing to do.
    //
    // A setTXfee failure is non-fatal: the zero-balance branch is a
    // pure-DB norefund terminalization and doesn't need the fee set,
    // so we keep running it. Only the refund-broadcast branch is
    // gated, which defers cleanly until the next tick. Pre-fix, a
    // single setTXfee throw blocked every expired wallet — including
    // genuinely-empty rows that don't even need the daemon.
    let canRefund = true;
    try {
      await this.grcRpc.setTXfee(config.MIN_FEE);
    } catch (e) {
      log.warn(
        'setTXfee failed in expired processor; this tick will only run '
        + `zero-balance terminalizations, refunds deferred: ${e}`,
      );
      canRefund = false;
    }

    for (const wallet of expiredWallets) {
      // eslint-disable-next-line no-await-in-loop
      await this.processOne(wallet, { canRefund });
    }
  }

  private async processOne(wallet: WalletRow, opts: { canRefund: boolean }): Promise<void> {
    const addr = wallet.address;

    // Any prior on-chain outbound (forward to merchant OR overpayment
    // refund to buyer) means we must NOT auto-refund the inbound
    // again — getReceivedByAddress is a one-way inbound counter and
    // findAllSenders walks gross amounts, so a fresh refund here would
    // double-pay the buyer (or even triple-pay them when overpayment
    // and forward both happened).
    //
    // Both columns are checked because the Round-5 marker redesign
    // moved the overpayment-refund persist + the forward persist into
    // SEPARATE UPDATEs (different markers). A cancel arriving between
    // them leaves the row with refund_tx set (overpayment went out)
    // but tx_out still null (forward never broadcast). The earlier
    // `tx_out !== null` alone check missed that window and re-opened
    // the same double-debit the Round-4 fix closed for the
    // combined-UPDATE design.
    //
    // Operator-replay (refunded → expired for a manual retry) must
    // clear BOTH tx_out and refund_tx themselves before flipping the
    // status back — there's no safe automated way to tell a stale
    // outbound from a fresh one, and getting it wrong costs real money.
    if (wallet.tx_out !== null || wallet.refund_tx !== null) {
      log.warn(
        `Expired wallet ${addr} already has a prior outbound on-chain `
        + `(tx_out=${wallet.tx_out ?? 'null'}, refund_tx=${wallet.refund_tx ?? 'null'}) `
        + '— parking as error to avoid double-refund.',
      );
      await this.setTerminal(wallet, WalletStatus.error);
      return;
    }

    // Refund off the CONFIRMED balance only — sending money back
    // against a still unconfirmed (double-spendable) payment would let
    // an attacker drain the hot wallet. The 0-conf figure is only
    // needed to tell "genuinely empty" apart from "inbound but not yet
    // confirmed", so we pay for that second RPC only when confirmed
    // is zero.
    let confirmedGrc: number;
    try {
      confirmedGrc = await this.grcRpc.getReceivedByAddress(addr, config.MIN_CONFIRMATIONS);
    } catch (e) {
      // Transient (RPC down / breaker open). No state change — the
      // wallet stays `expired` and is re-evaluated next tick.
      log.warn(`Expired processor: balance check failed for ${addr}: ${e}`);
      return;
    }

    if (grc2halford(confirmedGrc) <= ZERO) {
      // Don't terminalize on a daemon we already know is flaky:
      // setTXfee threw at the top of the tick, the daemon might be
      // mid-rescan or otherwise returning silent-zero getReceived
      // values that don't reflect chain state. Defer to a later tick
      // when the daemon has recovered.
      if (!opts.canRefund) {
        log.info(
          `Expired wallet ${addr} reports zero confirmed balance but setTXfee `
          + 'failed this tick — deferring terminalization until the daemon recovers.',
        );
        return;
      }
      await this.handleNoConfirmedBalance(wallet);
      return;
    }

    // Refund path needs the broadcast fee set. If setTXfee threw at
    // the top of the tick we bail before spending RPC budget on
    // senders we can't pay yet — the next tick will retry from scratch.
    if (!opts.canRefund) {
      log.info(
        `Expired wallet ${addr} has confirmed funds but setTXfee failed `
        + 'this tick — deferring refund until the fee is settable.',
      );
      return;
    }

    // Confirmed funds present → refund. Gate retries with the same
    // exponential backoff the funded/late processors use so a transient
    // sender-lookup miss or a locked daemon doesn't dead-end the
    // buyer's money.
    const attempts = Number(wallet.refund_attempts);
    if (attempts > 0 && !canRetryRefund(attempts, new Date(wallet.updated_at))) {
      log.info(
        `Skipping expired-refund retry on ${addr} — backoff window not elapsed `
        + `(attempts=${attempts})`,
      );
      return;
    }

    const senders = await findAllSenders(this.grcRpc, addr);
    if (!senders.length) {
      // Almost always transient: the incoming tx hasn't been indexed
      // yet, has rotated past the listTransactions fallback window, or
      // an RPC call hiccuped. Retry under backoff; only terminalize to
      // `error` once retries are exhausted.
      await this.deferOrError(wallet, attempts, 'no senders could be determined yet');
      return;
    }

    // SIGKILL-SAFETY: single batch marker spans the entire multi-
    // sender broadcast loop AND the finishWithRefundTx persist. With
    // a per-sender marker (the prior design), after the last sender's
    // clear the marker was null and a subsequent finishWithRefundTx
    // failure left no gate against the next tick re-walking
    // findAllSenders and broadcasting duplicate refunds. Keeping the
    // marker until finishWithRefundTx clears it ensures any crash
    // between broadcasts and terminalization keeps the row off the
    // processExpired SELECT (the SELECT filters marker IS NULL), and
    // recoverInterruptedSettlements logs it for operator reconciliation.
    const batchMarker = `expired_refund_batch:${wallet.id}:${Date.now()}`;
    const batchClaim = await db
      .updateTable('wallets')
      .set({ pending_broadcast: batchMarker, updated_at: now() })
      .where('id', '=', wallet.id)
      .where('pending_broadcast', 'is', null)
      .where('status', '=', WalletStatus.expired)
      .executeTakeFirst();
    if (!batchClaim.numUpdatedRows || Number(batchClaim.numUpdatedRows) === 0) {
      log.warn(
        `Expired-refund could not claim batch broadcast intent for ${addr} `
        + '— concurrent writer set a marker or changed status.',
      );
      return;
    }

    let firstRefundTx: string | null = null;
    let totalRefundedHalford = ZERO;
    let anyAttempted = false;
    let anyFailed = false;
    let timeoutSeen = false;

    for (const sender of senders) {
      if (sender.amountHalford <= minFeeHalford) {
        log.info(
          `Skipping dust refund of ${sender.amountHalford} halford to `
          + `${sender.address} for wallet ${addr} `
          + '(sender\'s contribution is smaller than the network fee).',
        );
        continue;
      }
      anyAttempted = true;
      const refundHalford = sender.amountHalford - minFeeHalford;
      const refundAmountGrc = Number(refundHalford) / config.HALFORD;

      try {
        // eslint-disable-next-line no-await-in-loop
        const tx = await this.grcRpc.sendToAddress(sender.address, refundAmountGrc);
        totalRefundedHalford += refundHalford;
        if (!firstRefundTx) firstRefundTx = tx;
        log.info(
          `Refunded ${refundAmountGrc} GRC to ${sender.address} for wallet `
          + `${addr} (tx ${tx}).`,
        );
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: Number(wallet.id),
          action: 'expired_refund',
          newStatus: tx,
        });
      } catch (e) {
        // Timeout-after-commit: daemon may have committed this send
        // even though the RPC reply was lost. We can't safely call
        // findAllSenders again next tick without risk of double-paying
        // this sender, so leave the batch marker in place and force
        // operator reconciliation.
        if (e instanceof TimeoutError) {
          log.error(
            `CRITICAL: expired refund sendToAddress to ${sender.address} for `
            + `${addr} timed out — daemon may have committed. Batch marker `
            + `${batchMarker} left in place for operator reconciliation.`,
          );
          timeoutSeen = true;
          break;
        }
        log.error(
          `Failed to refund ${refundAmountGrc} GRC to ${sender.address} `
          + `for wallet ${addr}: ${e}`,
        );
        anyFailed = true;
      }
    }

    // Bail without clearing the batch marker — recoverInterruptedSettlements
    // will surface it. processExpired's marker filter keeps the next tick
    // from re-entering, which would risk double-refunding any sender whose
    // broadcast may have committed.
    if (timeoutSeen) return;

    if (!anyAttempted) {
      // Every sender was below the dust threshold — nothing to do.
      // Clear the batch marker as part of the terminalization.
      await this.setTerminal(wallet, WalletStatus.norefund);
      return;
    }
    if (!firstRefundTx) {
      // Nothing went out and every send failed (classic locked/stuck
      // daemon). Safe to retry the whole set — no double-refund risk
      // because no money moved. Clear the batch marker before
      // deferring so the next tick can re-claim it.
      try {
        await db
          .updateTable('wallets')
          .set({ pending_broadcast: null, updated_at: now() })
          .where('id', '=', wallet.id)
          .where('pending_broadcast', '=', batchMarker)
          .execute();
      } catch (e) {
        log.error(`Failed to clear batch marker for ${addr}: ${e}`);
      }
      await this.deferOrError(wallet, attempts, 'every refund send failed');
      return;
    }
    // At least one refund tx landed. `refunded` if all succeeded;
    // `error` on partial success — retrying would re-pay the senders
    // that already got their money, so this one needs a human. Either
    // way we record the first tx that went out.
    await this.finishWithRefundTx(
      wallet,
      anyFailed ? WalletStatus.error : WalletStatus.refunded,
      firstRefundTx,
      totalRefundedHalford,
    );
  }

  // confirmed balance is zero: either nothing ever arrived (terminalize
  // as norefund) or funds are inbound but not yet MIN_CONFIRMATIONS
  // deep (wait — re-checked next tick, never terminalized as a failure).
  private async handleNoConfirmedBalance(wallet: WalletRow): Promise<void> {
    let totalGrc: number;
    try {
      totalGrc = await this.grcRpc.getReceivedByAddress(wallet.address, 0);
    } catch (e) {
      log.warn(`Expired processor: balance check failed for ${wallet.address}: ${e}`);
      return;
    }
    if (grc2halford(totalGrc) <= ZERO) {
      await this.setTerminal(wallet, WalletStatus.norefund);
      return;
    }
    log.info(
      `Expired wallet ${wallet.address} holds ${totalGrc} GRC still confirming `
      + '— deferring refund until it settles',
    );
  }

  // Terminalize a wallet that had a refund tx go out: `refunded` on
  // full success or `error` on partial success (left for manual
  // review; retrying would double-pay the senders that already got
  // their money). Only reset refund_attempts on the success path —
  // keeping a non-zero count on `error` preserves the "burned the
  // retry budget" diagnostic for operator queries / alerting; an
  // operator who deliberately flips the wallet back to expired for a
  // retry should clear refund_attempts themselves as part of that
  // decision.
  private async finishWithRefundTx(
    wallet: WalletRow,
    status: WalletStatus.refunded | WalletStatus.error,
    refundTx: string,
    totalRefundedHalford: bigint,
  ): Promise<void> {
    // Status-guarded so a concurrent writer that flipped the row out
    // from under us between our SELECT and now (e.g. an operator
    // admin script parking it in `error`) isn't silently clobbered.
    // The match-zero case is genuinely a lost race — the refund tx
    // is already on-chain, but a human owns the resolution.
    // Clears the batch marker as part of the terminalization so the
    // row leaves the recoverInterruptedSettlements stalled-marker
    // scan once it lands.
    const result = await db
      .updateTable('wallets')
      .set({
        status,
        tx_out: refundTx,
        refund_amount: totalRefundedHalford,
        ...(status === WalletStatus.refunded ? { refund_attempts: ZERO } : {}),
        pending_broadcast: null,
        updated_at: now(),
      })
      .where('id', '=', wallet.id)
      .where('status', '=', WalletStatus.expired)
      .executeTakeFirst();
    if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
      log.warn(
        `Expired processor lost the finalize race for ${wallet.address} `
        + `after broadcasting refund ${refundTx} — another writer changed `
        + 'the status. Manual reconciliation needed.',
      );
      return;
    }
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: Number(wallet.id),
      action: 'tx_out',
      oldStatus: '',
      newStatus: refundTx,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: Number(wallet.id),
      action: 'status',
      oldStatus: WalletStatus.expired,
      newStatus: status,
    });
  }

  // Bump the retry counter and keep the wallet `expired` so the next
  // eligible tick tries again — unless the retry budget is exhausted,
  // in which case terminalize to `error` for manual review. This is
  // what stops a transient sender-lookup miss from permanently
  // stranding the buyer's money.
  private async deferOrError(
    wallet: WalletRow,
    attempts: number,
    reason: string,
  ): Promise<void> {
    const next = attempts + 1;
    if (next >= config.MAX_REFUND_ATTEMPTS) {
      log.warn(
        `Expired-refund for ${wallet.address} exhausted ${config.MAX_REFUND_ATTEMPTS} `
        + `attempts (${reason}) — parking in error for manual review.`,
      );
      // Bump refund_attempts to `next` BEFORE the terminalize so an
      // operator querying `WHERE refund_attempts = MAX_REFUND_ATTEMPTS`
      // can find genuinely exhausted rows. Without this write, the
      // row would terminalize at attempts (= MAX-1), one short of the
      // diagnostic threshold setTerminal's preserve-on-error
      // contract is meant to expose.
      await db
        .updateTable('wallets')
        .set({ refund_attempts: BigInt(next), updated_at: now() })
        .where('id', '=', wallet.id)
        .where('status', '=', WalletStatus.expired)
        .execute();
      await this.setTerminal(wallet, WalletStatus.error);
      return;
    }
    // Status-guarded so a concurrent writer doesn't have its work
    // clobbered. If it fires, the deferral was effectively a no-op
    // and the wallet is no longer expired — log and move on.
    const result = await db
      .updateTable('wallets')
      .set({ refund_attempts: BigInt(next), updated_at: now() })
      .where('id', '=', wallet.id)
      .where('status', '=', WalletStatus.expired)
      .executeTakeFirst();
    if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
      log.info(`Expired-refund defer for ${wallet.address} no-oped — status changed.`);
      return;
    }
    log.warn(
      `Expired-refund attempt ${next}/${config.MAX_REFUND_ATTEMPTS} deferred for `
      + `${wallet.address}: ${reason} (staying expired, will retry under backoff).`,
    );
  }

  private async setTerminal(wallet: WalletRow, status: WalletStatus): Promise<void> {
    // Reset refund_attempts only on success terminals. On `error` keep
    // the count so operators can distinguish "errored on first try"
    // from "burned the full retry budget" by inspecting the row
    // directly (without joining db_logs).
    const resetAttempts = status === WalletStatus.refunded || status === WalletStatus.norefund;
    // Status-guarded — same reason as finishWithRefundTx. Also clears
    // any batch marker that may still be set (norefund path from
    // processOne lands here without an intervening marker clear).
    const result = await db
      .updateTable('wallets')
      .set({
        status,
        ...(resetAttempts ? { refund_attempts: ZERO } : {}),
        pending_broadcast: null,
        updated_at: now(),
      })
      .where('id', '=', wallet.id)
      .where('status', '=', WalletStatus.expired)
      .executeTakeFirst();
    if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
      log.warn(
        `Expired processor lost the terminalize race for ${wallet.address} `
        + `(intended ${status}) — another writer changed the status.`,
      );
      return;
    }
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: Number(wallet.id),
      action: 'status',
      oldStatus: WalletStatus.expired,
      newStatus: status,
    });
  }
}

export const WalletExpiredProcessorService = new WalletExpiredProcessorServiceClass();
