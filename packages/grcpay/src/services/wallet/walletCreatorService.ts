import { Wallet, WalletMode, WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { db, now } from '../../lib/db';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { grc2halford } from '../../lib/nomination';
import { generateToken, hashToken } from '../../lib/walletToken';
import { encryptWebhookSecret } from '../../lib/webhookSecret';

export class WalletsCreatorServiceClass {
  constructor(
    private grcRpc = rpc,
  ) {}

  public async createWallet(
    amountRequired: number,
    recipient?: string,
    mode?: WalletMode,
    lifespanSeconds?: number,
    webhookUrl?: string,
  ) {
    const resolvedMode = mode ?? WalletMode.checkout;
    if (!amountRequired) {
      throw new Error('Required amount is required');
    }

    // Preflight: if the caller supplied a forwarding recipient, ask
    // the wallet daemon to validate it BEFORE we mint a payment
    // address. Catches:
    //   * mainnet address configured on a testnet daemon (or vice
    //     versa) — different version byte, fails the checksum
    //   * malformed base58 that passed the Joi regex but isn't a
    //     real Gridcoin address
    //   * typos
    //
    // Without this, the error only surfaces at forwarding time
    // (minutes later, after the customer has paid) when the funded
    // processor's sendToAddress throws "Invalid Gridcoin address"
    // and flips the wallet to status=error. Recovery requires
    // operator DB surgery to fix the recipient and reset the
    // status. Failing fast at creation time turns the same bug
    // into an HTTP 400 the merchant sees immediately.
    if (recipient) {
      let validation;
      try {
        validation = await this.grcRpc.validateAddress(recipient);
      } catch (e) {
        throw new Error(`Failed to validate recipient address: ${e}`);
      }
      if (!validation.isvalid) {
        throw new Error(`Recipient ${recipient} is not a valid Gridcoin address for this network`);
      }
    }

    let address: string;
    try {
      address = await this.grcRpc.getNewAddress();
    } catch (e) {
      log.warn(`Failed to get new address, refilling keypool: ${e}`);
      await this.grcRpc.keyPoolRefill(100);
      address = await this.grcRpc.getNewAddress();
    }

    if (!address.length) {
      throw new Error('Unable to generate new address');
    }

    const amountRequiredHalford = grc2halford(amountRequired);

    // One-time token reveal: generate once, hash for storage, stash the
    // raw value on the Wallet instance so the presenter can include it
    // in the POST response. Subsequent loads via fromRow leave `token`
    // undefined so GETs never echo it back.
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);

    const timestamp = now();
    // Opt-in webhook config is inserted in the same transaction as the
    // wallet row: if the webhook write fails for any reason, we must
    // not leave the wallet behind, because the signing secret is a
    // one-time reveal and we'd have no way to re-emit it. Atomic or not
    // at all.
    const webhookSecret = webhookUrl ? generateToken() : null;
    const inserted = await db.transaction().execute(async (trx) => {
      const walletRow = await trx
        .insertInto('wallets')
        .values({
          address,
          recipient: recipient ?? null,
          amount_required: amountRequiredHalford,
          amount_recieved: BigInt(0),
          amount_pending: BigInt(0),
          status: WalletStatus.new,
          mode: resolvedMode,
          lifespan_seconds: lifespanSeconds == null ? null : BigInt(lifespanSeconds),
          token_hash: tokenHash,
          refund_attempts: BigInt(0),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (webhookUrl && webhookSecret) {
        await trx
          .insertInto('wallet_webhooks')
          .values({
            wallet_id: walletRow.id,
            url: webhookUrl,
            // Encrypted at rest when WEBHOOK_SECRET_KEY is set; the raw
            // value is still revealed once to the caller below.
            secret: encryptWebhookSecret(webhookSecret),
            created_at: timestamp,
            updated_at: timestamp,
          })
          .execute();
      }
      return walletRow;
    });

    const newWallet = Wallet.fromRow(inserted);
    newWallet.token = rawToken;

    const walletId = newWallet.id!;

    // Opt-in webhook config. No connectivity preflight here on
    // purpose (the URL was already syntactically validated by the Joi
    // schema; we do not ping caller-supplied URLs at creation). The
    // signing secret follows the same one-time-reveal contract as the
    // wallet token, but is stored RAW — a hashed HMAC key is useless
    // at delivery time.
    //
    // The webhook URL itself is intentionally NOT mirrored into
    // db_logs: integrators sometimes embed opaque tokens in the URL
    // path/query as poor-man's auth, and the audit table is too easy
    // to leak (backups, ops dashboards, future admin panel). The
    // canonical copy lives in wallet_webhooks.url where the dispatcher
    // reads it; that's where it should stay.
    if (webhookUrl && webhookSecret) {
      newWallet.webhookSecret = webhookSecret;
    }
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'amount_required',
      newStatus: String(amountRequiredHalford),
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'status',
      newStatus: WalletStatus.new,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'address',
      newStatus: address,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'recipient',
      newStatus: recipient,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'mode',
      newStatus: resolvedMode,
    });
    if (lifespanSeconds != null) {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId,
        action: 'lifespan_seconds',
        newStatus: String(lifespanSeconds),
      });
    }

    return newWallet;
  }
}

export const WalletsCreatorService = new WalletsCreatorServiceClass();
