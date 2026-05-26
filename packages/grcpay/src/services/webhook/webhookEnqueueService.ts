import { randomUUID } from 'crypto';
import { getEventEmitter } from '../../lib/event';
import { db, now } from '../../lib/db';
import { log } from '../../lib/log';
import { WalletStatus } from '../../models/Wallet';
import { WebhookDeliveryStatus } from '../../lib/database';
import { DbLogMessage } from '../dbLog/dbLogService';

// Status transitions worth a webhook. Everything the integrator needs
// to drive a checkout: payment detected (confirming), settled (funded
// / processed), or any terminal outcome (expired / refunded / norefund
// / error). Deliberately excludes:
//   * the new→new emit at wallet creation (the caller just got the
//     wallet back in the POST response — re-announcing "it's new" is
//     noise)
//   * flap-backs (confirming→new) from the reconciler oscillating on a
//     mempool drop — receivers treat status as latest-wins, and the
//     dedup constraint already collapses a re-entered transition
const WORTHY_NEW_STATUSES: ReadonlySet<string> = new Set([
  WalletStatus.confirming,
  WalletStatus.funded,
  WalletStatus.processed,
  WalletStatus.expired,
  WalletStatus.refunded,
  WalletStatus.norefund,
  WalletStatus.error,
]);

export function isWebhookWorthy(
  oldStatus: string | undefined,
  newStatus: string | undefined,
): boolean {
  if (!newStatus) return false;
  if (newStatus === oldStatus) return false;
  if (newStatus === WalletStatus.new) return false; // incl. confirming→new flap-back
  return WORTHY_NEW_STATUSES.has(newStatus);
}

function isUniqueViolation(e: unknown): boolean {
  // Match SQLITE_CONSTRAINT_UNIQUE specifically — better-sqlite3
  // sets `code` to that exact value on UNIQUE violations. The
  // earlier `startsWith('SQLITE_CONSTRAINT')` matched _NOTNULL /
  // _CHECK / _FOREIGNKEY / _PRIMARYKEY too, so any future schema
  // tightening would have silently swallowed real constraint errors
  // as "duplicate transition" and the webhook would never enqueue.
  // The message-based fallback handles the case where the driver
  // ever returns a bare 'SQLITE_CONSTRAINT' without a subcode.
  const code = (e as { code?: string })?.code ?? '';
  const message = e instanceof Error ? e.message : String(e);
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('UNIQUE constraint failed');
}

export class WebhookEnqueueServiceClass {
  constructor(
    private eventEmitter = getEventEmitter<DbLogMessage>(),
  ) {}

  public registerEventListener(): void {
    this.eventEmitter.on('log', this.enqueueIfWorthy);
  }

  // Arrow property so the unbound `.on('log', this.enqueueIfWorthy)`
  // reference keeps working regardless of call-site `this`.
  //
  // CRITICAL: this listener must NEVER throw. The 'log' emit is a
  // synchronous fan-out with an async listener; an unhandled rejection
  // here would surface process-wide and could take down the wallet
  // state machine. Unlike DbLogService.logInDb (which rethrows), we
  // catch-log-swallow everything — a missed webhook is recoverable,
  // a crashed processor is not.
  private enqueueIfWorthy = async (data: DbLogMessage): Promise<void> => {
    try {
      if (data.action !== 'status') return;
      if (!isWebhookWorthy(data.oldStatus, data.newStatus)) return;
      const newStatus = data.newStatus!;

      // One round trip: pull the wallet snapshot AND prove the wallet
      // opted in (LEFT JOIN, then filter on the hook id). Misses (the
      // common path — most wallets never opt in) still cost only one
      // query.
      const row = await db
        .selectFrom('wallets')
        .leftJoin('wallet_webhooks', 'wallet_webhooks.wallet_id', 'wallets.id')
        .select([
          'wallets.address',
          'wallets.amount_required',
          'wallets.amount_recieved',
          'wallets.amount_pending',
          'wallets.tx_out',
          'wallets.refund_tx',
          'wallets.refund_amount',
          'wallet_webhooks.id as hook_id',
        ])
        .where('wallets.id', '=', BigInt(data.walletId))
        .executeTakeFirst();
      if (!row || row.hook_id === null) return;

      const eventUuid = randomUUID();
      const createdAt = now();
      // Frozen snapshot — a later wallet mutation can't change what we
      // eventually deliver. Bigints as decimal strings (the wire
      // convention used everywhere else).
      const payload = JSON.stringify({
        id: eventUuid,
        type: 'wallet.status',
        walletAddress: row.address,
        oldStatus: data.oldStatus ?? null,
        newStatus,
        amountRequired: String(row.amount_required),
        amountReceived: String(row.amount_recieved),
        amountPending: String(row.amount_pending),
        txOut: row.tx_out,
        refundTx: row.refund_tx,
        refundAmount: row.refund_amount === null ? null : String(row.refund_amount),
        createdAt,
      });

      try {
        await db
          .insertInto('webhook_deliveries')
          .values({
            wallet_id: BigInt(data.walletId),
            event_uuid: eventUuid,
            // Normalise absent → '' (never NULL): SQLite UNIQUE treats
            // NULLs as distinct, so a NULL here would silently defeat
            // the (wallet_id, new_status, old_status) dedup constraint.
            old_status: data.oldStatus ?? '',
            new_status: newStatus,
            payload,
            status: WebhookDeliveryStatus.pending,
            attempts: BigInt(0),
            next_attempt_at: createdAt,
            last_response_code: null,
            last_error: null,
            created_at: createdAt,
            updated_at: createdAt,
          })
          .execute();
      } catch (e) {
        // Duplicate transition already enqueued — idempotent no-op.
        // Log it so operator-driven retries (e.g. finishWithRefundTx
        // docstring's "manually flip refunded→expired to retry") are
        // visible instead of silently dropped — without this the only
        // signal an integrator gets is the missing webhook delivery.
        if (isUniqueViolation(e)) {
          log.info(
            `Webhook dedup-hit for wallet ${data.walletId} `
            + `(${data.oldStatus ?? 'null'}→${newStatus}) — same transition `
            + 'already enqueued. Receiver will not see the repeat event.',
          );
          return;
        }
        throw e;
      }
    } catch (e) {
      log.error(`Webhook enqueue failed for wallet ${data.walletId}: ${e}`);
    }
  };
}

export const WebhookEnqueueService = new WebhookEnqueueServiceClass();
