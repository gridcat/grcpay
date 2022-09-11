import { WalletStatus } from '@prisma/client';
import { Wallet } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';

interface OpenWallet {
  id: bigint;
  address: string;
  amount_recieved: bigint;
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
      },
      where: {
        status: WalletStatus.new,
      },
    });
    if (!openWallets.length) {
      return;
    }
    const promisesPool = [];

    for (let i = 0; i < openWallets.length; i++) {
      const wallet = openWallets[i];
      promisesPool.push(this.updateWalletBalance(wallet));
    }
  }

  /**
   * Update wallet balance if possible
   */
  private async updateWalletBalance(wallet: OpenWallet): Promise<void> {
    log.info(`Checking balance for ${wallet.address}`);
    const balanceGrc = await this.grcRpc.getReceivedByAddress(wallet.address);
    const balanceHalford = BigInt(balanceGrc * config.HALFORD);
    if (balanceHalford === wallet.amount_recieved) {
      log.info(`Do not update wallet ${wallet.address} as balance didn't get changed: ${balanceGrc} grc`);
      return;
    }
    await this.wallet.model.update({
      where: {
        id: wallet.id,
      },
      data: {
        amount_recieved: balanceHalford,
      },
    });

    // Log it
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: wallet.id,
      action: 'amount_recieved',
      oldStatus: String(wallet.amount_recieved),
      newStatus: String(balanceHalford),
    });
  }
}

export const WalletsBalanceUpdaterService = new WalletsBalanceUpdaterServiceClass();
