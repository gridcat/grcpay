export type WalletStatus =
  | 'new'
  // Enough funds detected (confirmed + mempool) to cover the invoice,
  // but the confirmed portion alone hasn't reached MIN_CONFIRMATIONS
  // yet. Integrators should show a "waiting for confirmations" state
  // instead of continuing to ask for more funds.
  | 'confirming'
  | 'funded'
  | 'error'
  | 'expired'
  | 'processed'
  | 'refunded'
  | 'norefund';

// Keep the union narrow — the backend only accepts 'checkout' today.
// When crowdfunding ships, add it here and to the backend WalletMode.
export type WalletMode = 'checkout';

// 1 GRC = 100,000,000 halford. The backend stores amounts as halford BigInt
// and serializes them as strings, so we convert at the entity boundary —
// the rest of the UI works in GRC.
export const HALFORD_PER_GRC = 100_000_000;

// The backend presenter currently emits `amountRecieved` (the misspelling
// matches the DB column name); we tolerate both spellings here so a future
// presenter cleanup is non-breaking.
export interface WalletRawData {
  id?: string | number;
  address: string;
  recipient?: string | null;
  amountRequired: string | number;
  amountRecieved?: string | number;
  amountReceived?: string | number;
  // Inbound halford that the grcpay balance updater saw at 0-conf but
  // that hasn't yet reached MIN_CONFIRMATIONS. Reported alongside the
  // confirmed amountRecieved so integrators can show a "waiting for
  // confirmations" state without running their own RPC.
  amountPending?: string | number;
  status: WalletStatus;
  txOut?: string | null;
  refundTx?: string | null;
  refundAmount?: string | number | null;
  mode?: WalletMode;
  lifespanSeconds?: number | null;
  // One-time reveal on the POST /wallets response. Subsequent GETs
  // omit it, so only the original creator ever sees the raw value.
  token?: string;
  // Live confirmation depth and threshold. The backend computes
  // these on demand for `confirming` wallets only (it samples the
  // most recent indexed deposits and reports the min depth), so
  // they're absent on every other status. Surface them as an
  // "N of M" progress hint while the customer is waiting.
  confirmations?: number | null;
  confirmationsRequired?: number;
  createdAt?: string;
  updatedAt?: string;
}

function halfordToGrc(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  const halford = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(halford)) return 0;
  return halford / HALFORD_PER_GRC;
}

export class WalletEntity {
  public id?: string | number;

  public address: string;

  public recipient: string | null;

  /** Required payment amount, in GRC. */
  public amountRequired: number;

  /** Amount received so far, in GRC. */
  public amountReceived: number;

  /**
   * Unconfirmed inbound amount, in GRC. Represents funds the wallet
   * daemon has seen but that haven't yet reached MIN_CONFIRMATIONS
   * blocks. Surfaced in the UI as a "waiting for confirmations" notice
   * so the customer doesn't panic and resend.
   */
  public amountPending: number;

  public status: WalletStatus;

  public txOut: string | null;

  /**
   * Populated when GRCpay detected an overpayment and automatically
   * refunded the excess to the original sender. Null for exact payments
   * and for dust-sized overpayments that were too small to be worth
   * refunding (overpayment <= network fee).
   */
  public refundTx: string | null;

  /**
   * Total GRC actually sent back to customers as refunds (in the
   * multi-sender expired-refund case, this is the sum across all
   * per-sender refund txs). Null when no refund happened.
   */
  public refundAmount: number | null;

  /**
   * Wallet lifecycle mode. 'checkout' is the current single-order
   * merchant payment flow and the only value the backend accepts today.
   */
  public mode: WalletMode;

  /**
   * Per-wallet lifespan override in seconds. Null means "use the server
   * default" (2 hours for checkout). Future crowdfunding campaigns will
   * use this to extend the window to days or weeks.
   */
  public lifespanSeconds: number | null;

  /**
   * Per-wallet access token. Only ever set from the POST /wallets
   * response (the server-side one-time reveal). Callers that hold this
   * value can hit GET /wallets/:address and DELETE /wallets/:address
   * by passing it in the `X-Wallet-Token` header. Null when the entity
   * was hydrated from a GET response (the server doesn't echo it
   * back) or from a stored record that doesn't track secrets.
   */
  public token: string | null;

  /**
   * Live confirmation depth of the indexed deposits, only populated
   * while `status === 'confirming'`. Null when the backend couldn't
   * resolve it (nothing indexed yet, RPC blip), in which case the UI
   * should fall back to a generic "awaiting confirmations" copy.
   */
  public confirmations: number | null;

  /**
   * The `MIN_CONFIRMATIONS` threshold the backend is gating against.
   * Paired with `confirmations` so the integrator can render
   * "N of M". Null on any non-confirming status.
   */
  public confirmationsRequired: number | null;

  public createdAt?: string;

  public updatedAt?: string;

  public constructor(data: WalletRawData) {
    this.id = data.id;
    this.address = data.address;
    this.recipient = data.recipient ?? null;
    this.amountRequired = halfordToGrc(data.amountRequired);
    // Tolerate both the typo'd field name and the corrected one.
    this.amountReceived = halfordToGrc(data.amountRecieved ?? data.amountReceived);
    this.amountPending = halfordToGrc(data.amountPending);
    this.status = data.status;
    this.txOut = data.txOut ?? null;
    this.refundTx = data.refundTx ?? null;
    this.refundAmount = data.refundAmount != null
      ? halfordToGrc(data.refundAmount)
      : null;
    this.mode = data.mode ?? 'checkout';
    this.lifespanSeconds = data.lifespanSeconds ?? null;
    this.token = data.token ?? null;
    this.confirmations = data.confirmations ?? null;
    this.confirmationsRequired = data.confirmationsRequired ?? null;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  public get isSettled(): boolean {
    return this.status !== 'new';
  }

  /** How much GRC the customer still owes on this wallet — clamped at zero for overpayments. */
  public get amountRemaining(): number {
    return Math.max(0, this.amountRequired - this.amountReceived);
  }

  public get progressFraction(): number {
    if (this.amountRequired <= 0) return 0;
    return Math.min(1, this.amountReceived / this.amountRequired);
  }
}

/**
 * Format a GRC amount for display. Trims trailing zeros so 0.01 renders as
 * "0.01" instead of "0.01000000", but keeps full halford-precision when the
 * value actually needs it.
 */
export function formatGrc(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  // 8 decimals = halford precision; anything below that is rounding error.
  const fixed = amount.toFixed(8);
  return fixed.replace(/\.?0+$/, '') || '0';
}
