import { wallets, WalletStatus } from '@prisma/client';
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

export class WalletFundedProcessorServiceClass {
  constructor(
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  public async processFunded(): Promise<void> {
    log.info('Process expired wallets');
    // Process those with empty balance first
    await this.processWithoutRecipient();
    await this.processWithRecipient();
  }

  /**
   * A bit overcomplicated, as I Want to send logs too
   * Get all expired wallets with empty balance and mark it as norefund
   */
  private async processWithoutRecipient(): Promise<void> {
    log.info('Process funded without recipients');
    const fundedWallets = await this.wallet.model.findMany({
      select: { id: true },
      where: {
        status: WalletStatus.funded,
        recipient: null,
      },
    });
    const ids = fundedWallets.reduce((prev: bigint[], curr: { id: bigint }) => {
      prev.push(curr.id);
      return prev;
    }, []);
    if (ids.length) {
      log.info(`${ids.length} wallet(s) to be processed`);
      await this.wallet.model.updateMany({
        data: {
          status: WalletStatus.processed,
        },
        where: {
          id: {
            in: ids,
          },
        },
      });
      fundedWallets.forEach((wallet) => {
        getEventEmitter<DbLogMessage>().emit('log', {
          walletId: wallet.id,
          action: 'status',
          oldStatus: WalletStatus.funded,
          newStatus: WalletStatus.processed,
        });
      });
    }
  }

  private async processWithRecipient(): Promise<void> {
    log.info('Process funded wallets with recipient');
    const fundedWallets = await this.wallet.model.findMany({
      where: {
        status: WalletStatus.funded,
        recipient: {
          not: null,
        },
      },
    });
    console.log(fundedWallets);
    for (let i = 0; i < fundedWallets.length; i++) {
      const wallet = fundedWallets[i];
      // Set up fee
      await this.grcRpc.setTXfee(config.MIN_FEE);
      const amount = Number(wallet.amount_recieved) / config.HALFORD - config.MIN_FEE;
      // Send all minus fee, hope it will be fine ;-)
      // At the end there must be 0
      const tx = await this.grcRpc.sendToAddress(
        wallet.recipient,
        amount,
        wallet.address,
      );
      await this.wallet.model.update({
        where: {
          id: wallet.id,
        },
        data: {
          status: WalletStatus.processed,
          tx_out: tx,
        },
      });
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'status',
        oldStatus: WalletStatus.funded,
        newStatus: WalletStatus.processed,
      });
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId: wallet.id,
        action: 'tx_out',
        oldStatus: '',
        newStatus: tx,
      });
    }
  }
}

export const WalletFundedProcessorService = new WalletFundedProcessorServiceClass();
