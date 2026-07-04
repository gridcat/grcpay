import http from 'http';
import https from 'https';
import axios from 'axios';
import { db, now } from '../../lib/db';
import { config } from '../../config';
import { log } from '../../lib/log';
import {
  assertSafeWebhookUrl,
  createPinnedLookup,
} from '../../lib/ssrfGuard';
import {
  webhookSignatureHeader,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_ATTEMPT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from '../../lib/webhookSignature';
import { nextWebhookAttemptAt } from '../../lib/webhookBackoff';
import { decryptWebhookSecret } from '../../lib/webhookSecret';
import { withTimeout } from '../../lib/withTimeout';
import { WebhookDeliveryStatus } from '../../lib/database';
import type { WebhookDeliveryRow } from '../../lib/database';

export class WebhookDispatcherServiceClass {
  /**
   * Drain due deliveries. Scheduled via the single-flight schedule()
   * helper, and rows are processed SEQUENTIALLY — together that gives
   * per-wallet FIFO ordering without any locking. A backlog drains
   * oldest-first over successive ticks (bounded by WEBHOOK_BATCH_SIZE).
   */
  public async dispatchDue(): Promise<void> {
    const due = await db
      .selectFrom('webhook_deliveries')
      .selectAll()
      .where('status', '=', WebhookDeliveryStatus.pending)
      .where('next_attempt_at', '<=', now())
      .orderBy('id', 'asc')
      .limit(config.WEBHOOK_BATCH_SIZE)
      .execute();
    if (!due.length) return;

    log.info(`Webhook dispatcher: ${due.length} delivery(ies) due`);
    for (const row of due) {
      // Sequential on purpose — see the FIFO note above.
      // eslint-disable-next-line no-await-in-loop
      await this.deliverOne(row);
    }
  }

  private async deliverOne(row: WebhookDeliveryRow): Promise<void> {
    const hook = await db
      .selectFrom('wallet_webhooks')
      .select(['url', 'secret'])
      .where('wallet_id', '=', row.wallet_id)
      .executeTakeFirst();
    if (!hook) {
      // Config vanished (wallet/webhook removed). Nothing to deliver
      // to, ever — dead-letter immediately rather than spin. No
      // attempt was actually made, so leave row.attempts as-is.
      await this.markDead(row, Number(row.attempts), null, 'webhook config no longer exists');
      return;
    }

    // The attempt number we're about to make. Computed once here and
    // threaded through both the success path and the failure helpers
    // so all three writers agree.
    const attemptNumber = Number(row.attempts) + 1;

    try {
      // Decrypt the signing secret (no-op for legacy plaintext rows).
      // Inside the try so a key/ciphertext mismatch is recorded as a
      // delivery failure rather than crashing the dispatcher tick.
      const signingSecret = decryptWebhookSecret(hook.secret);

      // Re-validate + resolve on EVERY attempt. Acceptance-time only
      // checked syntax; DNS can repoint to an internal host hours
      // later. The pinned lookup binds the socket to exactly the IP we
      // just range-checked, so a rebind between here and connect can't
      // redirect us.
      const { url, pinnedIp, family } = await assertSafeWebhookUrl(hook.url);
      const lookup = createPinnedLookup(pinnedIp, family);

      const timestamp = Math.floor(Date.now() / 1000);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [WEBHOOK_EVENT_ID_HEADER]: row.event_uuid,
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
        [WEBHOOK_ATTEMPT_HEADER]: String(attemptNumber),
        // Sign the EXACT bytes we send (row.payload verbatim) so the
        // receiver's HMAC over the raw body matches.
        // event_id + attempt are covered by the MAC so a receiver
        // that trusts X-Grcpay-Event-Id (or X-Grcpay-Attempt) for
        // dedup/routing can't be fooled by header tampering on a
        // captured delivery.
        [WEBHOOK_SIGNATURE_HEADER]: webhookSignatureHeader(
          signingSecret,
          timestamp,
          row.event_uuid,
          attemptNumber,
          row.payload,
        ),
      };

      // AbortController binds the timeout to the underlying socket:
      // when withTimeout's outer race fires, it calls controller.abort()
      // and the axios request tears down its connection instead of
      // leaking past the timeout. Without this, a slow-body receiver
      // could hold the socket indefinitely across retries.
      const controller = new AbortController();
      const response = await withTimeout(
        axios.post(url.toString(), row.payload, {
          headers,
          signal: controller.signal,
          timeout: config.WEBHOOK_TIMEOUT_MS,
          maxRedirects: 0, // a 3xx is a misconfigured receiver → treat as failure
          transformRequest: [(d) => d], // send row.payload string untouched
          validateStatus: () => true, // we interpret the status ourselves
          httpAgent: new http.Agent({ lookup }),
          httpsAgent: new https.Agent({ lookup }),
        }),
        config.WEBHOOK_TIMEOUT_MS + 1_000,
        'Webhook delivery',
        controller,
      );

      if (response.status >= 200 && response.status < 300) {
        await db
          .updateTable('webhook_deliveries')
          .set({
            status: WebhookDeliveryStatus.delivered,
            attempts: BigInt(attemptNumber),
            last_response_code: response.status,
            last_error: null,
            updated_at: now(),
          })
          .where('id', '=', row.id)
          .execute();
        log.info(`Webhook delivered: event ${row.event_uuid} (HTTP ${response.status})`);
        return;
      }
      await this.recordFailure(row, attemptNumber, response.status, `HTTP ${response.status}`);
    } catch (e) {
      // Network error, SSRF rejection, timeout, redirect — all retry
      // (DNS/connectivity can be transient) and eventually dead-letter.
      const msg = e instanceof Error ? e.message : String(e);
      await this.recordFailure(row, attemptNumber, null, msg);
    }
  }

  private async recordFailure(
    row: WebhookDeliveryRow,
    attemptNumber: number,
    responseCode: number | null,
    error: string,
  ): Promise<void> {
    if (attemptNumber >= config.WEBHOOK_MAX_ATTEMPTS) {
      await this.markDead(row, attemptNumber, responseCode, error);
      return;
    }
    await db
      .updateTable('webhook_deliveries')
      .set({
        attempts: BigInt(attemptNumber),
        next_attempt_at: nextWebhookAttemptAt(attemptNumber),
        last_response_code: responseCode,
        last_error: error.slice(0, 500),
        updated_at: now(),
      })
      .where('id', '=', row.id)
      .execute();
    log.warn(
      `Webhook delivery failed (attempt ${attemptNumber}/${config.WEBHOOK_MAX_ATTEMPTS}) `
      + `for event ${row.event_uuid}: ${error}`,
    );
  }

  private async markDead(
    row: WebhookDeliveryRow,
    attemptNumber: number,
    responseCode: number | null,
    error: string,
  ): Promise<void> {
    await db
      .updateTable('webhook_deliveries')
      .set({
        status: WebhookDeliveryStatus.dead,
        attempts: BigInt(attemptNumber),
        last_response_code: responseCode,
        last_error: error.slice(0, 500),
        updated_at: now(),
      })
      .where('id', '=', row.id)
      .execute();
    log.warn(`Webhook delivery dead-lettered for event ${row.event_uuid}: ${error}`);
  }
}

export const WebhookDispatcherService = new WebhookDispatcherServiceClass();
