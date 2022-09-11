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

export class WalletExpiredProcessorServiceClass {
  constructor(
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  /**
   * With expired wallets:
   * - Check if any balance present
   * - If not, then mark wallet as processed, done
   * - If present, check who sent it by listing transactions
   * - Try to send it back
   * - Respect only latest address, do not overcomplicate
   */
  public async processExpired(): Promise<void> {
    log.info('Process expired wallets');
    // Process those with empty balance first
    await this.processWitZeroBalance();
  }

  private async processWitZeroBalance(): Promise<void> {
    const expiredEmptyWallets = await this.wallet.model.findMany({
      select: { id: true },
      where: {
        status: WalletStatus.expired,
        amount_recieved: 0,
      },
    });
    console.log(expiredEmptyWallets);
    const ids = expiredEmptyWallets.reduce((prev: bigint[], curr: { id: bigint }) => {
      prev.push(curr.id);
      return prev;
    }, []);
    if (ids.length) {
      log.info(`${ids.length} wallet(s) to be expired`);
      await this.wallet.model.updateMany({
        data: {
          status: WalletStatus.norefund,
        },
        where: {
          id: {
            in: ids,
          },
        },
      });
      expiredEmptyWallets.forEach((wallet) => {
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'status',
          oldStatus: WalletStatus.expired,
          newStatus: WalletStatus.norefund,
        });
      });
    }
  }
}

export const WalletExpiredProcessorService = new WalletExpiredProcessorServiceClass();
