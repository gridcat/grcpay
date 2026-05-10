import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { log } from '../../lib/log';
import { db, now } from '../../lib/db';
import { grc2halford } from '../../lib/nomination';

// Size of the daemon-wide listTransactions window scanned each tick.
// Must comfortably exceed the number of receive txs the daemon might
// see between ticks (JOBS_INTERVAL, default 10s). 500 gives ~50
// confirmed receives per second of headroom, more than any single
// merchant setup is realistically going to produce. Bumping this
// costs one RPC payload size per tick and nothing else.
const SCAN_COUNT = 500;

export class IncomingTxIndexerServiceClass {
  constructor(
    private grcRpc = rpc,
  ) {}

  /**
   * Walk the daemon's most-recent listTransactions window once and
   * persist every `receive` tx that lands on a wallet we still care
   * about. "Care about" means `updated_at >= now - LATE_PAYMENT_WINDOW`
   * — past that horizon the late-payment sweep ignores them, so
   * indexing them would be pure waste.
   *
   * Designed to be idempotent: the unique (wallet_id, txid) constraint
   * absorbs duplicate observations, so the same tx reappearing in the
   * scan window on subsequent ticks is a no-op.
   */
  public async indexIncomingTxs(): Promise<void> {
    const cutoffIso = new Date(Date.now() - config.LATE_PAYMENT_WINDOW * 1000).toISOString();
    const watchable = await db
      .selectFrom('wallets')
      .select(['id', 'address'])
      .where('updated_at', '>=', cutoffIso)
      .execute();
    if (!watchable.length) return;

    const addressToId = new Map(watchable.map((w) => [w.address, w.id]));

    let recent;
    try {
      recent = await this.grcRpc.listTransactions('*', SCAN_COUNT, 0);
    } catch (e) {
      log.warn(`Incoming-tx indexer: listTransactions failed: ${e}`);
      return;
    }

    const matches = recent.filter(
      (tx) => tx.category === 'receive' && addressToId.has(tx.address),
    );
    if (!matches.length) return;

    // Single multi-row INSERT with ON CONFLICT DO NOTHING — first
    // observation wins, subsequent observations bounce off the unique
    // (wallet_id, txid) index. One statement, one fsync. Counts are
    // small (tens, not thousands) because the filter above already
    // narrowed to our wallets.
    const observedAt = now();
    const rows = matches.map((tx) => ({
      wallet_id: addressToId.get(tx.address)!,
      txid: tx.txid,
      amount_halford: grc2halford(tx.amount),
      time: BigInt(tx.time),
      observed_at: observedAt,
    }));
    try {
      await db
        .insertInto('incoming_txs')
        .values(rows)
        .onConflict((oc) => oc.columns(['wallet_id', 'txid']).doNothing())
        .execute();
    } catch (e) {
      log.warn(`Incoming-tx indexer: batch insert failed (${rows.length} rows): ${e}`);
    }
  }
}

export const IncomingTxIndexerService = new IncomingTxIndexerServiceClass();
