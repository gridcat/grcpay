import { GridcoinRPC } from 'gridcoin-rpc';
import { log } from '../../lib/log';
import { config } from '../../config';
import { db } from '../../lib/db';

export interface SenderShare {
  /** The sender's address, decoded from the vin of one of the incoming txs. */
  address: string;
  /** Total halford this sender paid into the wallet, summed across all their incoming txs. */
  amountHalford: bigint;
  /** The transaction time of the most recent incoming tx from this sender (for ordering). */
  latestTime: number;
}

interface IncomingTx {
  txid: string;
  time: number;
  amountHalford: bigint;
}

/**
 * Resolve the sender of a single tx: the first input (vin) whose
 * prev-out address isn't the wallet itself. Returns null for a
 * self-spend / coinbase / unresolvable inputs. Throws on RPC error
 * (callers decide whether to skip or fail). A tx can have several
 * input addresses; we take the first non-self one — same convention
 * as the refund flow, which doesn't need per-output attribution.
 */
export async function resolveTxSender(
  rpc: GridcoinRPC,
  txid: string,
  walletAddress: string,
): Promise<string | null> {
  const rawTx = await rpc.getRawTransaction(txid, true);
  for (const vin of rawTx.vin) {
    if (!vin.txid || vin.vout === undefined) continue; // skip coinbase
    // eslint-disable-next-line no-await-in-loop
    const inputTx = await rpc.getRawTransaction(vin.txid, true);
    const candidate = inputTx.vout[vin.vout]?.scriptPubKey?.addresses?.[0];
    if (candidate && candidate !== walletAddress) return candidate;
  }
  return null;
}

async function loadIncoming(
  rpc: GridcoinRPC,
  walletAddress: string,
): Promise<IncomingTx[]> {
  // Indexed-table path. Wrapped in its own try/catch so any DB issue
  // (missing table in test envs, transient connection hiccup in prod)
  // falls through to the legacy listTransactions scan rather than
  // wedging the refund flow entirely.
  try {
    const recorded = await db
      .selectFrom('incoming_txs')
      .innerJoin('wallets', 'wallets.id', 'incoming_txs.wallet_id')
      .where('wallets.address', '=', walletAddress)
      .select(['incoming_txs.txid', 'incoming_txs.time', 'incoming_txs.amount_halford'])
      .execute();
    if (recorded.length) {
      return recorded.map((r) => ({
        txid: r.txid,
        time: Number(r.time),
        amountHalford: r.amount_halford,
      }));
    }
  } catch (e) {
    log.warn(
      `Sender lookup: indexed-tx read failed for ${walletAddress}, falling back to listTransactions: ${e}`,
    );
  }

  // Pre-indexer wallet (or non-grcpay address, or DB error above):
  // fall back to the original daemon-side scan. 100-item window is the
  // same limitation as before — nothing gets worse for these records.
  const transactions = await rpc.listTransactions('*', 100, 0);
  return transactions
    .filter((tx) => tx.category === 'receive' && tx.address === walletAddress)
    .map((tx) => ({
      txid: tx.txid,
      time: tx.time,
      // listTransactions reports `amount` in GRC (positive for
      // receives). Round to the nearest halford since GRC amounts come
      // back as JS floats, same convention as the indexer.
      amountHalford: BigInt(Math.round(tx.amount * config.HALFORD)),
    }));
}

/**
 * Walk the wallet's transaction history once and return a deduplicated
 * list of every sender that funded it, with their total amount.
 *
 * Used by both the overpayment-refund flow (picks the LATEST sender —
 * user policy: the one who pushed the wallet over the required amount
 * is the one who gets their mistake back) and the expired-refund flow
 * (iterates ALL senders — each gets back what they sent, minus the
 * per-sender fee).
 *
 * Returns an empty array if:
 *   - nothing was received at this address
 *   - every resolvable input is the wallet itself (self-spend)
 *   - any RPC call throws
 *
 * Results are sorted by `latestTime` ASCENDING, so callers that want
 * the most recent sender take `result[result.length - 1]`.
 *
 * Source of incoming txs, in order of preference:
 *   1. `incoming_txs` table — populated by the indexer on every
 *      job-loop tick. Doesn't depend on the daemon's listTransactions
 *      window, so it works even for wallets being refunded days after
 *      hundreds of newer txs have rotated past the recent-100 horizon.
 *   2. Legacy listTransactions scan — fallback for wallets that
 *      existed before the indexer (nothing in `incoming_txs` yet) or
 *      for raw addresses passed in by tests/scripts that aren't
 *      grcpay-managed. Same 100-item window as before; same silent
 *      miss on old records. No worse than pre-indexer behaviour.
 */
export async function findAllSenders(
  rpc: GridcoinRPC,
  walletAddress: string,
): Promise<SenderShare[]> {
  try {
    const incoming = await loadIncoming(rpc, walletAddress);
    if (!incoming.length) {
      return [];
    }

    // Aggregate by sender address. One incoming tx can theoretically
    // have multiple inputs from different senders; we credit the first
    // non-self sender per tx (same convention as the original single-
    // sender lookup — picking multiple sources per tx would require
    // decoding output indices and is overkill for grcpay's use case).
    const byAddress = new Map<string, SenderShare>();

    for (const tx of incoming) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const senderAddr = await resolveTxSender(rpc, tx.txid, walletAddress);
        if (!senderAddr) continue;

        const existing = byAddress.get(senderAddr);
        if (existing) {
          existing.amountHalford += tx.amountHalford;
          if (tx.time > existing.latestTime) {
            existing.latestTime = tx.time;
          }
        } else {
          byAddress.set(senderAddr, {
            address: senderAddr,
            amountHalford: tx.amountHalford,
            latestTime: tx.time,
          });
        }
      } catch (e) {
        // Skip this tx on RPC error but keep processing the others —
        // partial sender info is still useful.
        log.warn(`Skipping tx ${tx.txid} during sender lookup: ${e}`);
      }
    }

    return Array.from(byAddress.values()).sort((a, b) => a.latestTime - b.latestTime);
  } catch (e) {
    log.error(`Failed to determine senders for ${walletAddress}: ${e}`);
    return [];
  }
}

/**
 * Convenience wrapper for callers that just want the single most-recent
 * sender (the overpayment-refund flow — user policy is to refund the
 * latest contributor, the one whose payment pushed the wallet past the
 * required amount).
 */
export async function findSenderAddress(
  rpc: GridcoinRPC,
  walletAddress: string,
): Promise<string | null> {
  const senders = await findAllSenders(rpc, walletAddress);
  if (!senders.length) return null;
  return senders[senders.length - 1].address;
}
