import { subSeconds } from 'date-fns';
import { Prisma, WalletStatus } from '@prisma/client';
import { Wallet } from '../../models/Wallet';
import { config } from '../../config';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { getPrisma } from '../../lib/prisma';

export class WalletsServiceClass {
  constructor(
    private wallet = new Wallet(),
  ) {}

  /**
   * Find wallets which has received more or exact amount which is required
   * Mark those wallets as funded
   */
  public async findFundedWallets(): Promise<void> {
    log.info('Check for the funded wallets');
    // const status = WalletStatus.new;
    const fundedWallets = await getPrisma().$queryRaw<{id: bigint, status: string}[]>(Prisma.sql`
      SELECT
        id,
        status
      FROM wallets
      WHERE
        status IN (${WalletStatus.new})
        AND amount_recieved >= amount_required
    `);
    const ids = fundedWallets.reduce((prev: bigint[], curr: { id: bigint }) => {
      prev.push(curr.id);
      return prev;
    }, []);
    if (ids.length) {
      log.info(`${ids.length} wallet(s) to be marked as funded`);
      await this.wallet.model.updateMany({
        data: {
          status: WalletStatus.funded,
        },
        where: {
          id: {
            in: ids,
          },
        },
      });
    }
    fundedWallets.forEach((wallet) => {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'status',
        oldStatus: wallet.status,
        newStatus: WalletStatus.funded,
      });
    });
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
      select: { id: true, status: true },
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
      openedWallets.forEach((wallet) => {
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'status',
          oldStatus: wallet.status,
          newStatus: WalletStatus.expired,
        });
      });
    }
  }
}

export const WalletsService = new WalletsServiceClass();
