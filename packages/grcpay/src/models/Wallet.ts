import { GenericInterface } from './Generic';
import type { WalletRow } from '../lib/database';

export enum WalletStatus {
  new = 'new',
  // The customer has deposited enough funds to cover amountRequired
  // when counting both the confirmed balance AND the 0-conf pending
  // balance, but the confirmed portion hasn't yet reached the
  // configured MIN_CONFIRMATIONS threshold. Treated as "on the way,
  // not settled" — never paid out to the merchant, but gives the
  // integrator a strong signal to render a "payment detected, waiting
  // for confirmations" state to the customer. Transitions to
  // `funded` once the confirmed balance actually meets the invoice.
  // Can also fall back to `new` if a pending tx drops out of the
  // mempool (reorg, replacement, fee-too-low).
  confirming = 'confirming',
  funded = 'funded',
  error = 'error',
  expired = 'expired',
  processed = 'processed',
  refunded = 'refunded',
  norefund = 'norefund',
}

export enum WalletMode {
  checkout = 'checkout',
  // Future: 'crowdfunding'. Validation layer keeps the accepted set
  // narrow until that flow is built.
}

export class Wallet implements GenericInterface {
  public id?: number;

  public createdAt?: Date;

  public updatedAt?: Date;

  public address!: string;

  public recipient!: string | null;

  public amountRequired!: bigint;

  public amountRecieved!: bigint;

  // Unconfirmed balance — funds the wallet daemon has seen but that
  // haven't reached config.MIN_CONFIRMATIONS yet. Tracked separately
  // so integrators can render a "waiting for N confirmations" state.
  public amountPending!: bigint;

  public txOut?: string | null;

  public refundTx?: string | null;

  public refundAmount?: bigint | null;

  public mode!: WalletMode;

  // Null means "use the LIFE_SPAN env default". Set per-wallet only
  // when the caller needs to override (future crowdfunding campaigns).
  public lifespanSeconds?: number | null;

  // Persisted server-side as a SHA256 hash of the raw token.
  public tokenHash!: string;

  // Transient: populated only on the Wallet instance returned by the
  // creator service so it can be serialized on the POST /wallets
  // response. Loading a wallet from DB via fromRow leaves this
  // undefined, which is why the presenter conditionally omits it on
  // subsequent GETs — the raw token is a one-time reveal.
  public token?: string;

  public refundAttempts!: number;

  public status!: WalletStatus;

  public qr?: string;

  public attributes = [
    'id',
    'createdAt',
    'updatedAt',
    'attributes',
    'address',
    'recipient',
    'amountRequired',
    'amountRecieved',
    'amountPending',
    'status',
    'refundTx',
    'refundAmount',
    'mode',
    'lifespanSeconds',
    'token',
  ];

  // Maps a raw DB row (snake_case, bigint id) into the camelCase
  // value object the rest of the app uses. better-sqlite3 returns
  // every INTEGER column as bigint; we narrow id / refundAttempts /
  // lifespanSeconds to number here because they comfortably fit and
  // the consumers expect arithmetic with regular numbers.
  public static fromRow(row: WalletRow): Wallet {
    const wallet = new Wallet();
    wallet.id = Number(row.id);
    wallet.address = row.address;
    wallet.recipient = row.recipient;
    wallet.amountRequired = row.amount_required;
    wallet.amountRecieved = row.amount_recieved;
    wallet.amountPending = row.amount_pending;
    wallet.status = row.status as WalletStatus;
    wallet.txOut = row.tx_out;
    wallet.refundTx = row.refund_tx;
    wallet.refundAmount = row.refund_amount;
    wallet.mode = row.mode as WalletMode;
    wallet.lifespanSeconds = row.lifespan_seconds === null
      ? null
      : Number(row.lifespan_seconds);
    wallet.tokenHash = row.token_hash;
    wallet.refundAttempts = Number(row.refund_attempts);
    wallet.createdAt = new Date(row.created_at);
    wallet.updatedAt = new Date(row.updated_at);
    return wallet;
  }
}
