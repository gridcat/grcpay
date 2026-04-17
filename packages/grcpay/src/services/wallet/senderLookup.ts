import { GridcoinRPC } from 'gridcoin-rpc';
import { log } from '../../lib/log';
import { config } from '../../config';

export interface SenderShare {
  /** The sender's address, decoded from the vin of one of the incoming txs. */
  address: string;
  /** Total halford this sender paid into the wallet, summed across all their incoming txs. */
  amountHalford: bigint;
  /** The transaction time of the most recent incoming tx from this sender (for ordering). */
  latestTime: number;
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
 */
export async function findAllSenders(
  rpc: GridcoinRPC,
  walletAddress: string,
): Promise<SenderShare[]> {
  try {
    const transactions = await rpc.listTransactions('*', 100, 0);
    const incoming = transactions.filter(
      (tx) => tx.category === 'receive' && tx.address === walletAddress,
    );
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
        const rawTx = await rpc.getRawTransaction(tx.txid, true);
        let senderAddr: string | null = null;
        for (const vin of rawTx.vin) {
          if (!vin.txid || vin.vout === undefined) continue; // skip coinbase
          const inputTx = await rpc.getRawTransaction(vin.txid, true);
          const output = inputTx.vout[vin.vout];
          if (output?.scriptPubKey?.addresses?.length) {
            const candidate = output.scriptPubKey.addresses[0];
            if (candidate !== walletAddress) {
              senderAddr = candidate;
              break;
            }
          }
        }
        if (!senderAddr) continue;

        // listTransactions reports `amount` in GRC (positive for receives).
        // Convert to halford for precise arithmetic; round to the nearest
        // halford since GRC amounts come back as JS floats.
        const halford = BigInt(Math.round(tx.amount * config.HALFORD));
        const existing = byAddress.get(senderAddr);
        if (existing) {
          existing.amountHalford = existing.amountHalford + halford;
          if (tx.time > existing.latestTime) {
            existing.latestTime = tx.time;
          }
        } else {
          byAddress.set(senderAddr, {
            address: senderAddr,
            amountHalford: halford,
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
