import { Wallet, WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { grc2halford } from '../../lib/nomination';

interface OpenWallet {
  id: number;
  address: string;
  amount_recieved: bigint;
  amount_pending: bigint;
}

export class WalletsBalanceUpdaterServiceClass {
  constructor(
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  /**
   * I do not care if wallet will became expired and then second after
   * balance gets updated. We ain't sooooo strict here.
   * It is fine, as all amount will be sent back anyway.
   */
  public async updateBalances(): Promise<void> {
    log.info('Check open wallets balances');
    const openWallets = await this.wallet.model.findMany({
      select: {
        id: true,
        address: true,
        amount_recieved: true,
        amount_pending: true,
      },
      where: {
        status: {
          // Both `new` (no payment yet or partial) and `confirming`
          // (payment seen on-chain but not yet MIN_CONFIRMATIONS deep)
          // are still waiting for balance updates. Excluding confirming
          // here would leave its pending→confirmed transition blind.
          in: [WalletStatus.new, WalletStatus.confirming],
        },
      },
    });
    if (!openWallets.length) {
      return;
    }
    const promisesPool: Promise<void>[] = [];

    for (let i = 0; i < openWallets.length; i++) {
      const wallet = openWallets[i];
      promisesPool.push(this.updateWalletBalance(wallet));
    }

    await Promise.all(promisesPool);
  }

  /**
   * Update wallet balance if possible.
   *
   * We ask the wallet daemon for TWO balances — one at the configured
   * MIN_CONFIRMATIONS threshold (the "settled" amount that counts toward
   * the wallet's required balance) and one at 0-conf (the full amount
   * the daemon has seen, including mempool + immature blocks). The
   * difference is the "pending" amount — funds on their way but not
   * safe enough to settle yet. Pending is persisted next to the
   * confirmed amount so integrators can show a "waiting for N
   * confirmations" state without making their own RPC calls.
   */
  private async updateWalletBalance(wallet: OpenWallet): Promise<void> {
    log.info(`Checking balance for ${wallet.address} (min confs=${config.MIN_CONFIRMATIONS})`);
    const [confirmedGrc, totalGrc] = await Promise.all([
      this.grcRpc.getReceivedByAddress(wallet.address, config.MIN_CONFIRMATIONS),
      this.grcRpc.getReceivedByAddress(wallet.address, 0),
    ]);

    // grc2halford routes through decimal.js so raw float math artifacts
    // (e.g. 4.48007 * 1e8 → 448007000.00000006) can't crash BigInt().
    const balanceHalford = grc2halford(confirmedGrc);
    // max(0, ...) guards against the rare race where the daemon reports
    // a slightly lower 0-conf total than its own confirmed snapshot.
    const rawPending = grc2halford(totalGrc) - balanceHalford;
    const pendingHalford = rawPending > BigInt(0) ? rawPending : BigInt(0);

    if (
      balanceHalford === wallet.amount_recieved
      && pendingHalford === wallet.amount_pending
    ) {
      log.info(`Do not update wallet ${wallet.address} as balance didn't get changed: ${confirmedGrc} grc settled, ${totalGrc} grc total`);
      return;
    }
    await this.wallet.model.update({
      where: {
        id: wallet.id,
      },
      data: {
        amount_recieved: balanceHalford,
        amount_pending: pendingHalford,
      },
    });

    if (balanceHalford !== wallet.amount_recieved) {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'amount_recieved',
        oldStatus: String(wallet.amount_recieved),
        newStatus: String(balanceHalford),
      });
    }
    if (pendingHalford !== wallet.amount_pending) {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'amount_pending',
        oldStatus: String(wallet.amount_pending),
        newStatus: String(pendingHalford),
      });
    }
  }
}

export const WalletsBalanceUpdaterService = new WalletsBalanceUpdaterServiceClass();
