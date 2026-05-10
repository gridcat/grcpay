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

export interface Database {
  wallets: WalletsTable;
  db_logs: DbLogsTable;
  incoming_txs: IncomingTxsTable;
}

export type WalletRow = Selectable<WalletsTable>;
export type NewWalletRow = Insertable<WalletsTable>;
export type WalletRowUpdate = Updateable<WalletsTable>;

export type DbLogRow = Selectable<DbLogsTable>;
export type NewDbLogRow = Insertable<DbLogsTable>;

export type IncomingTxRow = Selectable<IncomingTxsTable>;
export type NewIncomingTxRow = Insertable<IncomingTxsTable>;
