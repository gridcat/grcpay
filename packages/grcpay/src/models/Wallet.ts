import { wallets } from '@prisma/client';
import { getPrisma } from '../lib/prisma';
import { GenericInterface } from './Generic';

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
  // response. Loading a wallet from DB via fromModel leaves this
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

  public static fromModel(wallet: wallets): Wallet {
    const walletObj = new Wallet();
    walletObj.address = wallet.address;
    walletObj.amountRecieved = wallet.amount_recieved;
    walletObj.amountPending = wallet.amount_pending;
    walletObj.amountRequired = wallet.amount_required;
    walletObj.createdAt = wallet.created_at;
    walletObj.id = wallet.id;
    walletObj.recipient = wallet.recipient;
    walletObj.status = wallet.status as WalletStatus;
    walletObj.txOut = wallet.tx_out;
    walletObj.refundTx = wallet.refund_tx;
    walletObj.refundAmount = wallet.refund_amount;
    walletObj.mode = wallet.mode as WalletMode;
    walletObj.lifespanSeconds = wallet.lifespan_seconds;
    walletObj.tokenHash = wallet.token_hash;
    walletObj.refundAttempts = wallet.refund_attempts;
    walletObj.updatedAt = wallet.updated_at;
    return walletObj;
  }

  constructor(public model = getPrisma().wallets) {}
}
