import type {
  ColumnType,
  Generated,
  Selectable,
  Insertable,
  Updateable,
} from 'kysely';

// Datetimes are stored as TEXT ISO-8601 strings (the format Date.toISOString()
// produces). The app always supplies them — there is no DEFAULT
// CURRENT_TIMESTAMP in the schema, so the format stays uniform across
// every row and lexicographic comparisons in SQL stay correct.
type IsoDateTime = string;

interface WalletsTable {
  // SQLite aliases INTEGER PRIMARY KEY to ROWID, which is what makes
  // autoincrement work. Returned from better-sqlite3 as bigint
  // (defaultSafeIntegers is on); Wallet.fromRow narrows it to number.
  id: Generated<bigint>;

  // Unique guards against a wallet restore resurfacing an address
  // already in the table — two rows would let findWalletByAddress pick
  // the wrong one and hand the auth middleware a mismatched token_hash.
  address: string;
  recipient: string | null;

  amount_required: bigint;

  // Settled balance — only counts txs that have reached
  // config.MIN_CONFIRMATIONS blocks. The funded-processor compares this
  // to amount_required to decide when a wallet is funded, so same-block
  // reorgs can't trigger merchant settlement for a tx that later
  // disappears.
  amount_recieved: ColumnType<bigint, bigint | undefined, bigint>;

  // Unconfirmed inbound balance — funds the daemon has seen but that
  // haven't yet reached MIN_CONFIRMATIONS. Reported to integrators so
  // they can show a "waiting for N confirmations" state without
  // making their own RPC calls. Never factored into settlement math.
  // Drops back to 0 once everything has confirmed.
  amount_pending: ColumnType<bigint, bigint | undefined, bigint>;

  status: string;

  tx_out: string | null;

  // Populated when an overpayment was detected and automatically
  // refunded to the original sender. Null for exact payments and for
  // overpayments too small to be worth refunding (overpayment <=
  // MIN_FEE). In the multi-sender case this holds the FIRST refund
  // txid; additional refund txids are in db_logs only.
  refund_tx: string | null;

  // Total halford actually refunded (summed across all per-sender
  // refund txs in the multi-sender case). Null when no refund happened.
  // In the single-sender case this equals overpayment - MIN_FEE.
  refund_amount: bigint | null;

  // Dimension flag for the wallet lifecycle. 'checkout' is the current
  // single-order merchant payment flow (default). Future modes — most
  // notably 'crowdfunding' — will branch settlement and refund
  // behaviour off this column instead of introducing new statuses.
  // Keep the set of accepted values narrow; validate in the Joi schema,
  // not here.
  mode: ColumnType<string, string | undefined, string>;

  // Per-wallet lifespan override in seconds. Null means "use the
  // LIFE_SPAN env default" (2h for checkout). Crowdfunding campaigns
  // will set this to days/weeks; flash sales could set it to minutes.
  // Read by the expired-wallet processor, never by settlement.
  // Returned as bigint by the driver (safeIntegers) — Wallet.fromRow
  // narrows to number for app code.
  lifespan_seconds: bigint | null;

  // SHA256 (hex) of the per-wallet access token generated at creation
  // time. The raw token is returned once in the POST /wallets response
  // and never stored server-side — it gates GET /wallets/:address and
  // DELETE /wallets/:address so only the integrator who holds it can
  // read wallet state or cancel a live wallet. Storing the hash rather
  // than the token means a DB leak doesn't hand attackers cancellation
  // rights on live wallets.
  token_hash: string;

  // Cross-cycle retry counter for refund RPC failures. The funded
  // processor increments this on overpayment-refund failure and
  // retries on the next cycle, falling back to "forward everything"
  // once it exceeds config.MAX_REFUND_ATTEMPTS. The late-payment
  // processor uses the same column and the same cap so a broken
  // daemon can't wedge a wallet in a permanent retry loop.
  refund_attempts: ColumnType<bigint, bigint | undefined, bigint>;

  // Pre-broadcast intent marker. Set BEFORE every sendToAddress call,
  // cleared in the same statement that persists the broadcast's
  // result txid. A SIGKILL between sendToAddress returning and the
  // durable result UPDATE would otherwise leave the row at a state
  // where the next tick re-detects "needs broadcast" and re-broadcasts.
  // loadFunded / expireWallets / cancel all filter on IS NULL so a
  // mid-broadcast row stays off their candidate set;
  // recoverInterruptedSettlements walks IS NOT NULL rows on boot and
  // reconciles against the daemon's recent send history.
  // Format: `<type>:<wallet_id>:<extra>:<unix_ts>` (see the
  // pending_broadcast migration for the type set).
  pending_broadcast: string | null;

  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

interface DbLogsTable {
  id: Generated<bigint>;
  wallet_id: bigint;
  action: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: IsoDateTime;
}

// Per-wallet incoming receive txids, recorded by the incoming-tx
// indexer on every job-loop tick while a wallet is still within
// LATE_PAYMENT_WINDOW. senderLookup reads from this table instead of
// walking the daemon-wide listTransactions window, which rotates past
// a few hundred recent txs on a busy wallet daemon.
interface IncomingTxsTable {
  id: Generated<bigint>;
  wallet_id: bigint;
  txid: string;
  amount_halford: bigint;
  // Tx time from the daemon (seconds since epoch). Used by
  // senderLookup to order senders by most-recent contribution so the
  // overpayment-refund flow can pick the sender that pushed the
  // wallet over the required amount.
  time: bigint;
  observed_at: IsoDateTime;
}

// Opt-in outbound-webhook config, one row per wallet that passed a
// webhookUrl at creation. `secret` is the RAW HMAC key (not a hash like
// wallets.token_hash) — we need it intact at delivery time to sign
// every payload; it's revealed to the integrator once and never again.
interface WalletWebhooksTable {
  id: Generated<bigint>;
  wallet_id: bigint;
  url: string;
  secret: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// Closed lifecycle for a queued delivery row. Enum'd (not bare string
// literals) so a typo'd status can't silently make a row unclaimable —
// same rationale as WalletStatus.
export const WebhookDeliveryStatus = {
  pending: 'pending',
  delivered: 'delivered',
  dead: 'dead',
} as const;
export type WebhookDeliveryStatus =
  typeof WebhookDeliveryStatus[keyof typeof WebhookDeliveryStatus];

// The durable delivery queue. One row per webhook-worthy status
// transition. Durability lives here rather than in the in-process
// event emitter, so a restart between enqueue and delivery can't lose
// the event. `old_status` is normalised to '' (never NULL) by the
// enqueue path so the (wallet_id, new_status, old_status) unique
// dedup constraint actually fires.
interface WebhookDeliveriesTable {
  id: Generated<bigint>;
  wallet_id: bigint;
  event_uuid: string;
  old_status: string;
  new_status: string;
  payload: string;
  status: WebhookDeliveryStatus;
  attempts: ColumnType<bigint, bigint | undefined, bigint>;
  next_attempt_at: IsoDateTime;
  // INTEGER column → bigint on read (defaultSafeIntegers), but we only
  // ever write a plain HTTP status number or null.
  last_response_code: ColumnType<bigint | null, number | null, number | null>;
  last_error: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Database {
  wallets: WalletsTable;
  db_logs: DbLogsTable;
  incoming_txs: IncomingTxsTable;
  wallet_webhooks: WalletWebhooksTable;
  webhook_deliveries: WebhookDeliveriesTable;
}

export type WalletRow = Selectable<WalletsTable>;
export type NewWalletRow = Insertable<WalletsTable>;
export type WalletRowUpdate = Updateable<WalletsTable>;

export type DbLogRow = Selectable<DbLogsTable>;
export type NewDbLogRow = Insertable<DbLogsTable>;

export type IncomingTxRow = Selectable<IncomingTxsTable>;
export type NewIncomingTxRow = Insertable<IncomingTxsTable>;

export type WalletWebhookRow = Selectable<WalletWebhooksTable>;
export type NewWalletWebhookRow = Insertable<WalletWebhooksTable>;

export type WebhookDeliveryRow = Selectable<WebhookDeliveriesTable>;
export type NewWebhookDeliveryRow = Insertable<WebhookDeliveriesTable>;
export type WebhookDeliveryRowUpdate = Updateable<WebhookDeliveriesTable>;
