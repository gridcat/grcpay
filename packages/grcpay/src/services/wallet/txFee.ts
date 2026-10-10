import { GridcoinRPC } from 'gridcoin-rpc';
import { getEventEmitter } from '../../lib/event';
import { log } from '../../lib/log';
import { grc2halford, MIN_FEE_HALFORD as minFeeHalford } from '../../lib/nomination';
import { DbLogMessage } from '../dbLog/dbLogService';

/**
 * Record what the daemon actually charged for a tx grcpay broadcast.
 *
 * Every payout reserves MIN_FEE out of the amount it sends, but the
 * daemon charges MIN_FEE per started KB and covers any difference with
 * extra inputs from the shared wallet. Nothing else records that
 * difference, so this writes a `tx_fee` row to db_logs per broadcast:
 * charged vs reserved fee and the tx size in bytes.
 *
 * Measurement only. Call it after the send is persisted; it swallows
 * every error so it can never fail or repeat a payout.
 */
export async function recordTxFee(
  rpc: GridcoinRPC,
  walletId: number,
  txid: string,
): Promise<void> {
  try {
    const tx = await rpc.getTransaction(txid);
    // gettransaction reports the fee as a NEGATIVE amount, and the
    // gridcoin-rpc Transaction type doesn't declare the field at all.
    const { fee } = tx as { fee?: unknown };
    if (typeof fee !== 'number') {
      log.warn(`recordTxFee: no fee in gettransaction for ${txid}`);
      return;
    }
    const chargedHalford = grc2halford(Math.abs(fee));
    const hex = await rpc.getRawTransaction(txid, false);
    const bytes = hex.length / 2;

    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'tx_fee',
      newStatus: txid,
      detail: `charged ${chargedHalford} halford, reserved ${minFeeHalford} halford, ${bytes} bytes`,
    });
    if (chargedHalford > minFeeHalford) {
      log.warn(
        `Fee overrun on ${txid}: charged ${chargedHalford} halford for ${bytes} bytes, `
        + `reserved ${minFeeHalford}. The shared wallet paid the difference.`,
      );
    }
  } catch (e) {
    log.warn(`recordTxFee: could not read the fee of ${txid}: ${e}`);
  }
}
