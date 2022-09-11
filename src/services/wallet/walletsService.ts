import { subSeconds } from 'date-fns';
import { WalletStatus } from '@prisma/client';
import { Wallet } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { log } from '../../lib/log';

export class WalletsServiceClass {
  constructor(
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  public async updateBalances(): Promise<void> {
    log.info('Check open wallets balances');
    const openWallets = await this.wallet.model.findMany({
      select: { id: true, address: true },
      where: {
        status: WalletStatus.new,
      },
    });
    if (!openWallets.length) {
      return;
    }
    for (let i = 0; i < openWallets.length; i++) {
      const wallet = openWallets[i];
      console.log(`Check balance for ${wallet.address}`);
      // const balance = await this.getBalance(wallet.address);
      const balance = await this.grcRpc.getBalance(wallet.address);
      console.log(balance);
    }
  }

  /**
   * Useles?
   * @deprecated
   * @param address
   * @returns
   */
  private async getBalance(address: string): Promise<number> {
    const balance = await this.grcRpc.getBalance(address);
    return balance;
  }

  /**
   * Find all wallets which seems to be expired and update the status to expired
   *
   * @returns {Promise<void>}
   * @memberof WalletsServiceClass
   */
  public async expireWallets(): Promise<void> {
    // Check opened wallets
    log.info('Check for expired wallets');
    const span = subSeconds(Date.now(), config.LIFE_SPAN);
    const openedWallets = await this.wallet.model.findMany({
      select: { id: true },
      where: {
        created_at: {
          lte: span,
        },
        status: {
          in: [
            WalletStatus.new,
            WalletStatus.error,
          ],
        },
      },
    });
    const ids = openedWallets.reduce((prev: bigint[], curr: { id: bigint }) => {
      prev.push(curr.id);
      return prev;
    }, []);
    // console.log(openedWallets, ids);
    // Expire those wallets
    if (ids.length) {
      log.info(`${ids.length} wallet(s) to be expired`);
      await this.wallet.model.updateMany({
        data: {
          status: WalletStatus.expired,
        },
        where: {
          id: {
            in: ids,
          },
        },
      });
    }
  }
}

export const WalletsService = new WalletsServiceClass();
