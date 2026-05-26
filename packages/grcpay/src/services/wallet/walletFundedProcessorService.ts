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
import { TimeoutError } from '../../lib/withTimeout';
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
  // Per-wallet dedup for the stalled-marker alert. Keys are
  // `${walletId}:${marker}`. Once a marker has fired its alert in this
  // process lifetime, we don't re-log it on every tick — operator
  // alerting wired to ERROR-level events would otherwise wedge under
  // duplicate pages. A restart re-arms every alert, which is the
  // right behavior (operator should re-notice on first boot post-fix).
  private stalledAlerted = new Set<string>();

  constructor(
    private grcRpc = rpc,
  ) {}

  public async processFunded(): Promise<void> {
    log.info('Process funded wallets');

    // Recovery sweep: settle wallets that crashed between the tx_out
    // write and the status flip in a previous cycle. Without this,
    // loadFunded()'s `tx_out IS NULL` guard would leave them stranded
    // in `funded` forever, and the merchant would never see a
    // funded→processed transition for a forward that already broadcast.
    await this.recoverInterruptedSettlements();

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

    // CRASH-RECOVERY: a prior tick may have already broadcast the
    // overpayment refund and persisted refund_tx + refund_amount
    // (durable write below) but crashed before the caller's
    // merchant-forward UPDATE. loadFunded will hand us the row again
    // on the next tick — we must NOT re-broadcast, that would double-
    // pay the buyer. Re-derive the original RefundResult from the
    // persisted row so the caller's forward math (debitedHalford,
    // refundedHalford) lines up with what actually went on-chain.
    if (wallet.refund_tx !== null && wallet.refund_amount !== null) {
      log.warn(
        `Recovering persisted overpayment refund for ${wallet.address}: `
        + `tx ${wallet.refund_tx}, ${wallet.refund_amount} halford. `
        + 'Skipping re-broadcast.',
      );
      return {
        outcome: 'success',
        txid: wallet.refund_tx,
        debitedHalford: wallet.refund_amount + minFeeHalford,
        refundedHalford: wallet.refund_amount,
      };
    }

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

    // SIGKILL-SAFETY: pre-broadcast intent marker. Without it, a
    // crash between sendToAddress returning and the durable refund_tx
    // UPDATE would leave refund_tx=NULL, and the next tick would
    // re-detect positive overpayment and re-broadcast.
    const intentMarker = `overpayment_refund:${wallet.id}:${Date.now()}`;
    const claim = await db
      .updateTable('wallets')
      .set({ pending_broadcast: intentMarker, updated_at: now() })
      .where('id', '=', wallet.id)
      .where('pending_broadcast', 'is', null)
      .where('status', '=', WalletStatus.funded)
      .where('refund_tx', 'is', null)
      .executeTakeFirst();
    if (!claim.numUpdatedRows || Number(claim.numUpdatedRows) === 0) {
      // Concurrent writer set its own marker or flipped status.
      // Return 'retry' — broadcast didn't happen, safe to retry next
      // tick under the existing backoff window.
      log.warn(
        `Overpayment refund could not claim broadcast intent for ${wallet.address} `
        + '— concurrent writer.',
      );
      return {
        outcome: 'retry',
        txid: null,
        debitedHalford: BigInt(0),
        refundedHalford: BigInt(0),
      };
    }

    // Broadcast is one try/catch — its failure is "didn't happen on-
    // chain, safe to retry". Anything AFTER sendToAddress returns is
    // a DIFFERENT failure class: the refund is real on-chain, so the
    // catch path must not say "retry" (which would re-broadcast next
    // tick and double-pay the buyer).
    let tx: string;
    try {
      tx = await this.grcRpc.sendToAddress(sender, refundAmountGrc);
    } catch (e) {
      // Timeout-after-commit: same hazard as the merchant-forward
      // catch path — daemon may have committed the broadcast before
      // the RPC reply dropped. Keep the marker; recovery is operator-
      // driven via recoverInterruptedSettlements. Returning 'retry'
      // here would let the next tick re-enter and broadcast a second
      // overpayment refund.
      if (e instanceof TimeoutError) {
        log.error(
          `CRITICAL: overpayment refund sendToAddress for ${wallet.address} `
          + 'timed out — daemon may have committed the broadcast. Marker '
          + `${intentMarker} left in place for operator reconciliation.`,
        );
        return {
          outcome: 'abandoned',
          txid: null,
          debitedHalford: BigInt(0),
          refundedHalford: BigInt(0),
        };
      }
      // Pre-commit failure (connection refused, wallet locked, etc.) —
      // broadcast didn't happen, clear the marker so the next tick
      // can retry.
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
          + `overpayment refund failure: ${e2}. Marker ${intentMarker} stranded.`,
        );
      }
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

    const refundedHalford = overpayment - minFeeHalford;

    // CRASH-SAFETY: persist refund_tx + refund_amount IMMEDIATELY
    // after the broadcast. If the process dies between this point
    // and the caller's merchant-forward UPDATE, the next tick's
    // refundOverpaymentIfAny call detects the persisted refund_tx
    // (recovery branch at the top) and skips re-broadcast — without
    // this write the buyer's overpayment would be paid twice. We
    // RETRY with in-process backoff and HALT THE PROCESS on
    // permanent failure rather than letting outcome='retry' propagate
    // (which would re-enter refundOverpaymentIfAny next tick and
    // re-broadcast). The broadcast is real on-chain; the chain is
    // the authoritative record an operator can reconstruct from.
    let persisted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let updateError: unknown = null;
      let matchedRow = false;
      try {
        // executeTakeFirst + numUpdatedRows check guards against a
        // silent 0-row match (marker cleared externally between
        // sendToAddress and this UPDATE — no current path does this,
        // defense-in-depth): without the check we'd return success
        // here, the next tick's recovery branch would see refund_tx
        // null on disk, and broadcast a second overpayment refund.
        const result = await db
          .updateTable('wallets')
          .set({
            refund_tx: tx,
            refund_amount: refundedHalford,
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
          `Overpayment refund_tx persist attempt ${attempt + 1}/3 failed for `
          + `${wallet.address} (tx ${tx}): ${updateError}`,
        );
      } else {
        log.error(
          `Overpayment refund_tx persist matched 0 rows for ${wallet.address} `
          + `(tx ${tx}, marker ${intentMarker}) — marker cleared externally. `
          + 'Treating as persist failure.',
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 50 * (attempt + 1)); });
    }
    if (!persisted) {
      log.error(
        'CRITICAL: overpayment refund_tx persist failed permanently for '
        + `${wallet.address}. tx ${tx} is on-chain. The intent marker `
        + `(${intentMarker}) keeps loadFunded from re-picking-up the row; `
        + 'recoverInterruptedSettlements will reconcile from chain history '
        + 'on next boot. Halting process.',
      );
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }

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
      refundedHalford,
    };
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
      // Exclude crash-recovery candidates: a funded row with tx_out
      // already set is a half-settled wallet whose forward broadcast
      // landed on-chain in a prior cycle. recoverInterruptedSettlements
      // flips those to `processed` separately so we never re-broadcast
      // a forward we already sent.
      .where('tx_out', 'is', null)
      // Exclude wallets with a broadcast in flight (pre-broadcast
      // intent marker set, durable result UPDATE hasn't landed yet).
      // recoverInterruptedSettlements walks these on boot to
      // reconcile against the daemon's send history — handing one to
      // processWithRecipient here would risk a double-broadcast.
      .where('pending_broadcast', 'is', null)
      .execute();
  }

  // Two recovery branches, both called on every tick before the
  // normal processing pass:
  //
  //   (A) tx_out already on-chain, status flip didn't happen.
  //       loadFunded skips these (tx_out IS NOT NULL); this branch
  //       finishes the funded→processed transition that the crashed
  //       cycle would have emitted.
  //
  //   (B) pending_broadcast intent marker set, durable result UPDATE
  //       never landed. The broadcast MAY have happened on-chain
  //       (SIGKILL between sendToAddress returning and the UPDATE)
  //       or MAY NOT have (SIGKILL during the RPC round-trip). We
  //       leave these wallets alone — log + skip. The intent marker
  //       keeps loadFunded/expireWallets/cancel from re-picking-up
  //       the row; an operator must reconcile against on-chain
  //       history (gridcoinresearchd listtransactions) and either
  //       clear the marker (no broadcast happened) or set the
  //       appropriate result column + clear the marker (broadcast
  //       did happen). Auto-reconciling here would require parsing
  //       the daemon's send history with enough confidence to know
  //       we're picking the right tx, which is brittle enough that
  //       it's pre-launch better to fail loud than guess.
  private async recoverInterruptedSettlements(): Promise<void> {
    const stuck = await db
      .selectFrom('wallets')
      .select(['id', 'tx_out'])
      .where('status', '=', WalletStatus.funded)
      .where('tx_out', 'is not', null)
      // Mirror loadFunded's mode filter: settlement math assumes
      // checkout semantics, so don't auto-finalize a future non-
      // checkout wallet that somehow reached funded with tx_out set.
      .where('mode', '=', WalletMode.checkout)
      // A row with tx_out AND a marker is an inconsistent operator-
      // partial-fix state (operator wrote tx_out but forgot to clear
      // the marker). Flipping status to processed here would leave
      // the marker stranded and the branch-B alert would fire forever.
      // Skip it; the operator's reconciliation must clear both
      // columns in one step.
      .where('pending_broadcast', 'is', null)
      .execute();
    if (stuck.length) {
      log.warn(`Recovering ${stuck.length} interrupted settlement(s) — tx_out already on-chain.`);
      for (const wallet of stuck) {
        // eslint-disable-next-line no-await-in-loop
        const result = await db
          .updateTable('wallets')
          .set({ status: WalletStatus.processed, updated_at: now() })
          .where('id', '=', wallet.id)
          .where('status', '=', WalletStatus.funded)
          .where('tx_out', 'is not', null)
          .where('mode', '=', WalletMode.checkout)
          .where('pending_broadcast', 'is', null)
          .executeTakeFirst();
        if (result.numUpdatedRows && Number(result.numUpdatedRows) > 0) {
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
            newStatus: wallet.tx_out!,
          });
        }
      }
    }

    // Throttle by marker age: a marker younger than the settle
    // timeout is almost certainly a legitimate in-flight broadcast
    // (the late-payment processor runs on its own schedule and can
    // hold a marker for >JOBS_INTERVAL). Logging those on every
    // job-loop tick generates ~1 alert per JOBS_INTERVAL per wallet
    // — operator alerting (ERROR-level) wedges before any genuinely
    // stalled marker stands out. Marker format ends with `:<unix_ms>`;
    // parse the trailing timestamp and only flag when it's older
    // than a generous settle-and-recover window.
    const stalled = await db
      .selectFrom('wallets')
      .select(['id', 'address', 'pending_broadcast'])
      .where('pending_broadcast', 'is not', null)
      .execute();
    const ageThresholdMs = 5 * 60 * 1000; // 5 minutes
    const nowMs = Date.now();
    // Forget alerts for markers we no longer see (operator cleared
    // the marker, or wallet finished settlement). Without this the
    // Set grows unboundedly across a long-running process.
    const stillStalledKeys = new Set<string>();
    for (const wallet of stalled) {
      const marker = wallet.pending_broadcast!;
      const dedupKey = `${wallet.id}:${marker}`;
      stillStalledKeys.add(dedupKey);
      const trailingTs = Number(marker.slice(marker.lastIndexOf(':') + 1));
      const ageMs = Number.isFinite(trailingTs) ? nowMs - trailingTs : Infinity;
      if (ageMs < ageThresholdMs) continue;
      // Per-process-lifetime dedup: log once per (wallet, marker)
      // tuple. A restart re-arms the alert so an operator who fixed
      // the underlying issue but missed the original page still gets
      // re-notified on the next boot.
      if (this.stalledAlerted.has(dedupKey)) continue;
      this.stalledAlerted.add(dedupKey);
      log.error(
        `WALLET STALLED MID-BROADCAST: ${wallet.address} pending_broadcast=${marker} `
        + `(age ${Math.round(ageMs / 1000)}s). Inspect chain history (gridcoinresearchd `
        + 'listtransactions) and reconcile manually: either clear pending_broadcast (no '
        + 'on-chain tx) or set the appropriate result column (tx_out for forwards, '
        + 'refund_tx for refunds) and then clear pending_broadcast.',
      );
    }
    // Prune dedup entries for markers that no longer exist — bounds
    // memory and lets a NEW marker on the same wallet re-fire its
    // alert later.
    for (const key of this.stalledAlerted) {
      if (!stillStalledKeys.has(key)) this.stalledAlerted.delete(key);
    }
  }

  private async processWithoutRecipient(fundedWallets: WalletRow[]): Promise<void> {
    log.info('Process funded without recipients');
    if (!fundedWallets.length) return;
    log.info(`${fundedWallets.length} wallet(s) to be processed`);
    for (const wallet of fundedWallets) {
      if (this.shouldDeferForBackoff(wallet)) continue;

      const refund = await this.refundOverpaymentIfAny(wallet);

      if (refund.outcome === 'retry') {
        // Status guard: if a cancel raced and already flipped this row
        // to `expired` with refund_attempts=0, we mustn't overwrite
        // those values — the expired processor's backoff math reads
        // refund_attempts/updated_at to decide when to retry the
        // buyer refund, and a stale N+1 here would defer the buyer's
        // money for REFUND_RETRY_BASE_DELAY * 2^N seconds.
        await db
          .updateTable('wallets')
          .set({
            refund_attempts: BigInt(Number(wallet.refund_attempts) + 1),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .where('status', '=', WalletStatus.funded)
          .execute();
        continue;
      }
      if (refund.outcome === 'abandoned') {
        log.warn(
          `Overpayment refund for ${wallet.address} exhausted retries — processing `
          + 'wallet anyway so the merchant sweep is not blocked.',
        );
      }

      // Atomic settlement: only flip funded → processed if the row is
      // still funded. A concurrent cancel that landed between
      // loadFunded() above and this UPDATE leaves status=expired; the
      // status guard makes the UPDATE write 0 rows and the cancel
      // wins cleanly. No-recipient wallets have no on-chain broadcast,
      // so unlike processWithRecipient there is no tx_out to record
      // and nothing to recover after the race.
      const result = await db
        .updateTable('wallets')
        .set({
          status: WalletStatus.processed,
          refund_tx: refund.txid,
          refund_amount: refund.txid ? refund.refundedHalford : null,
          refund_attempts: BigInt(0),
          updated_at: now(),
        })
        .where('id', '=', wallet.id)
        .where('status', '=', WalletStatus.funded)
        .executeTakeFirst();
      if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
        log.warn(
          `No-recipient settlement raced with a cancel for ${wallet.address} — `
          + 'cancel wins. Refund flow will handle any remaining balance.',
        );
        continue;
      }
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
        // Status-guarded — see the matching block in processWithoutRecipient.
        await db
          .updateTable('wallets')
          .set({
            refund_attempts: BigInt(Number(wallet.refund_attempts) + 1),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .where('status', '=', WalletStatus.funded)
          .execute();
        continue;
      }
      if (refund.outcome === 'abandoned') {
        log.warn(
          `Overpayment refund for ${wallet.address} exhausted retries — forwarding `
          + 'full balance to merchant so the payout is not blocked.',
        );
      }

      // SIGKILL-SAFETY: pre-broadcast intent marker. Without this, a
      // SIGKILL between sendToAddress returning and the durable UPDATE
      // below would leave the row at status=funded, tx_out=NULL, and
      // the next tick's loadFunded would re-pick-it-up and broadcast
      // a SECOND merchant forward. The marker takes the row out of
      // loadFunded's candidate set (which now excludes
      // pending_broadcast IS NOT NULL); recoverInterruptedSettlements
      // walks marker rows on boot and reconciles against the daemon.
      const intentMarker = `forward:${wallet.id}:${Date.now()}`;
      const claim = await db
        .updateTable('wallets')
        .set({ pending_broadcast: intentMarker, updated_at: now() })
        .where('id', '=', wallet.id)
        .where('pending_broadcast', 'is', null)
        .where('status', '=', WalletStatus.funded)
        .where('tx_out', 'is', null)
        .executeTakeFirst();
      if (!claim.numUpdatedRows || Number(claim.numUpdatedRows) === 0) {
        log.warn(
          `Funded processor could not claim broadcast intent for ${wallet.address} `
          + '— concurrent writer changed status or set its own marker.',
        );
        continue;
      }

      let tx: string | null = null;
      try {
        // Forward math drains the hot wallet cleanly in either branch:
        //   success   → remaining = required, forward = required - fee
        //   none/abandoned → remaining = received, forward = received - fee
        const remainingHalford = wallet.amount_recieved - refund.debitedHalford;
        const forwardAmountGrc = Number(remainingHalford - minFeeHalford) / config.HALFORD;
        tx = await this.grcRpc.sendToAddress(
          wallet.recipient!,
          forwardAmountGrc,
          wallet.address,
        );

        // CRASH-SAFETY: write tx_out + clear the intent marker in the
        // same statement, regardless of status. A crash between
        // sendToAddress returning and the status flip below would
        // otherwise leave the on-chain forward invisible to the
        // system — and the expired processor would see status=expired,
        // tx_out=NULL, confirmed balance > 0 and refund the buyer too
        // (double-debit). With tx_out written first,
        // recoverInterruptedSettlements() finishes the transition on
        // the next boot.
        //
        // The `pending_broadcast = intentMarker` guard keeps this
        // UPDATE idempotent and atomic with the intent claim above —
        // only the cycle that set the marker can clear it.
        await db
          .updateTable('wallets')
          .set({
            tx_out: tx,
            refund_tx: refund.txid,
            refund_amount: refund.txid ? refund.refundedHalford : null,
            pending_broadcast: null,
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .where('pending_broadcast', '=', intentMarker)
          .execute();

        // Now attempt the status flip. If a cancel landed between
        // loadFunded() and here, the row is `expired` — this UPDATE
        // matches 0 rows and the cancel wins cleanly. The expired
        // processor's tx_out guard parks the wallet as `error` (the
        // forward already happened, so we can't refund the buyer).
        const result = await db
          .updateTable('wallets')
          .set({
            status: WalletStatus.processed,
            refund_attempts: BigInt(0),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .where('status', '=', WalletStatus.funded)
          .executeTakeFirst();
        if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
          log.warn(
            `Funded processor lost the settlement race for ${wallet.address}: `
            + `cancel landed after sendToAddress broadcast ${tx}. tx_out is `
            + 'recorded; expired processor will park the wallet for review.',
          );
          getEventEmitter<DbLogMessage>().emit('log', {
            walletId: Number(wallet.id),
            action: 'tx_out_after_cancel',
            newStatus: tx,
          });
          continue;
        }
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
        // CRITICAL distinction: if `tx` is non-null the forward
        // broadcast already landed on-chain — flipping status to
        // `error` here would let walletsService.expireWallets re-
        // include the row (`status=error AND tx_out IS NULL AND
        // refund_tx IS NULL`), the expired processor would see no
        // tx_out and refund the buyer their full balance, and the
        // merchant would have been double-paid. Instead, try one
        // last durable write of tx_out and leave the row at
        // status=funded so recoverInterruptedSettlements finishes
        // the transition next tick.
        if (tx !== null) {
          log.error(
            `CRITICAL: forward broadcast (${tx}) for ${wallet.address} `
            + `but post-broadcast bookkeeping failed: ${e}. Retrying `
            + 'last-ditch tx_out persistence so recoverInterruptedSettlements '
            + 'can finish the transition next tick.',
          );
          // In-process retry with backoff. Most realistic failures
          // here are SQLITE_BUSY-after-timeout or short-lived FS
          // hiccups — a brief retry resolves them. The intent marker
          // is still set, so the next tick would skip this row even
          // if we couldn't write here; recoverInterruptedSettlements
          // would resolve it from chain history.
          // Preflight: if the in-try UPDATE actually landed before the
          // outer try threw (e.g., only the status-flip UPDATE threw,
          // not the tx_out UPDATE), tx_out is already on disk and the
          // marker is already cleared. Re-running the last-ditch
          // UPDATE keyed on `pending_broadcast = intentMarker` would
          // match 0 rows on every attempt and force a needless
          // process.exit(1). Read the row first and short-circuit if
          // we already wrote. recoverInterruptedSettlements branch A
          // will finish the funded→processed transition next tick.
          const preflight = await db
            .selectFrom('wallets')
            .select(['tx_out', 'pending_broadcast'])
            .where('id', '=', wallet.id)
            .executeTakeFirst();
          let persisted = preflight?.tx_out === tx && preflight?.pending_broadcast === null;
          if (persisted) {
            log.info(
              `Last-ditch persist no-op for ${wallet.address}: tx_out already `
              + `written (${tx}), marker already cleared. Status flip will be `
              + 'finished by recoverInterruptedSettlements on next tick.',
            );
          }
          for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
            let updateError: unknown = null;
            let matchedRow = false;
            try {
              // executeTakeFirst + numUpdatedRows so a silent 0-row
              // match doesn't pass for success — without this check,
              // a marker that's been cleared externally would let us
              // declare success without writing tx_out, and the next
              // tick's loadFunded (marker IS NULL, tx_out IS NULL,
              // status=funded) would re-broadcast a SECOND forward.
              const r = await db
                .updateTable('wallets')
                .set({
                  tx_out: tx,
                  refund_tx: refund.txid,
                  refund_amount: refund.txid ? refund.refundedHalford : null,
                  pending_broadcast: null,
                  updated_at: now(),
                })
                .where('id', '=', wallet.id)
                .where('pending_broadcast', '=', intentMarker)
                .executeTakeFirst();
              matchedRow = !!r.numUpdatedRows && Number(r.numUpdatedRows) > 0;
            } catch (e2) {
              updateError = e2;
            }
            if (matchedRow) {
              persisted = true;
              break;
            }
            if (updateError) {
              log.error(
                `Last-ditch tx_out write attempt ${attempt + 1}/3 failed `
                + `for ${wallet.address}: ${updateError}`,
              );
            } else {
              log.error(
                `Last-ditch tx_out write matched 0 rows for ${wallet.address} `
                + `(tx ${tx}, marker ${intentMarker}) — marker cleared externally. `
                + 'Treating as persist failure.',
              );
            }
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => { setTimeout(r, 50 * (attempt + 1)); });
          }
          if (!persisted) {
            // DB persistently rejects writes. The marker stays in
            // place; loadFunded skips this row on subsequent ticks
            // (pending_broadcast IS NOT NULL filter), and
            // recoverInterruptedSettlements will reconcile it from
            // the daemon's send history on the next boot. Halt now
            // so the orchestrator restarts us into the recovery path.
            log.error(
              'CRITICAL: tx_out persistence failed permanently for '
              + `${wallet.address}. tx ${tx} is on-chain. pending_broadcast `
              + `marker (${intentMarker}) left in place so loadFunded skips `
              + 'this row. Halting process so recoverInterruptedSettlements '
              + 'reconciles it on next boot.',
            );
            // eslint-disable-next-line no-process-exit
            process.exit(1);
          }
          continue;
        }
        log.error(`Failed to process funded wallet ${wallet.address}: ${e}`);
        // Timeout-after-commit hazard: when sendToAddress rejects with
        // a TimeoutError, the daemon MAY have committed the broadcast
        // before the RPC reply was dropped. Treating this as "no
        // broadcast happened" and flipping to `error` would let
        // expireWallets re-include the row → buyer refund issued by
        // expired processor → on top of the on-chain forward the
        // daemon may have actually broadcast → double-debit. Keep the
        // marker set; recoverInterruptedSettlements will log it for
        // operator reconciliation against on-chain history. Pre-commit
        // failures (connection refused, wallet locked, malformed RPC)
        // are safe to retry/refund — they fall through to the normal
        // marker-clear + status=error path.
        if (e instanceof TimeoutError) {
          log.error(
            `CRITICAL: sendToAddress for ${wallet.address} timed out — the `
            + 'daemon may have committed the broadcast before the RPC reply '
            + `was dropped. Marker ${intentMarker} left in place; operator `
            + 'must reconcile against chain history.',
          );
          continue;
        }
        // Pre-commit failure: split into an unconditional marker-clear
        // and a status-guarded status-flip. The old single-statement
        // form trapped its own marker when a concurrent cancel had
        // already flipped status to expired — the status guard then
        // matched 0 rows, the catch `continue`d, and the marker was
        // permanently stranded with no automated recovery.
        try {
          await db
            .updateTable('wallets')
            .set({ pending_broadcast: null, updated_at: now() })
            .where('id', '=', wallet.id)
            .where('pending_broadcast', '=', intentMarker)
            .execute();
        } catch (e2) {
          // Clear-marker DB failure is the worst case here (broadcast
          // didn't happen but the marker stays). Log loud; the row is
          // stuck pending operator action via recoverInterruptedSettlements.
          log.error(
            `Failed to clear marker for ${wallet.address} after pre-commit `
            + `sendToAddress failure: ${e2}. Marker ${intentMarker} stranded.`,
          );
          continue;
        }
        // Status flip is best-effort: if a concurrent writer has
        // already moved the row to expired (the cancel path now also
        // requires marker IS NULL, so this is genuinely rare), accept
        // the loss and let the other writer's intent win.
        //
        // refund_attempts is reset to 0 here on purpose. This row is
        // intended to auto-recover via walletsService.expireWallets,
        // which only re-includes error rows with refund_attempts=0 to
        // avoid the churn loop that previously cycled expired-
        // processor exhausted-budget rows through error→expired→error.
        // The tradeoff: we lose the "burned the retry budget"
        // diagnostic that setTerminal(error) preserves in the expired
        // processor. Acceptable here because funded-catch rows are
        // recovery candidates, not human-investigation candidates.
        const result = await db
          .updateTable('wallets')
          .set({
            status: WalletStatus.error,
            refund_attempts: BigInt(0),
            updated_at: now(),
          })
          .where('id', '=', wallet.id)
          .where('status', '=', WalletStatus.funded)
          .executeTakeFirst();
        if (!result.numUpdatedRows || Number(result.numUpdatedRows) === 0) {
          log.warn(
            `Funded processor error path lost the race for ${wallet.address} `
            + '— concurrent cancel or another writer changed the status. '
            + 'Marker cleared, no further action needed.',
          );
          continue;
        }
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
