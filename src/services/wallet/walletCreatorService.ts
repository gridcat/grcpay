import { WalletStatus } from '@prisma/client';
import { Wallet } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { config } from '../../config';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';

export class WalletsCreatorServiceClass {
  constructor(
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  public async createWallet(
    amountRequired: number,
    recipient?: string,
  ) {
    if (!amountRequired) {
      throw new Error('Required amount is required');
    }

    // generate new payment address
    let address: string;
    try {
      address = await this.grcRpc.getNewAddress();
    } catch (e) {
      console.log(e);
      console.log('Refill the keypool');
      await this.grcRpc.keyPoolRefill(100);
      address = await this.grcRpc.getNewAddress();
    }

    if (!address.length) {
      throw new Error('Unable to generate new address');
    }

    const amountRequiredHalford = amountRequired * config.HALFORD;

    const newWallet = await this.wallet.model.create({
      data: {
        amount_required: amountRequiredHalford,
        amount_recieved: 0,
        status: WalletStatus.new,
        address,
        recipient,
      },
    });

    // A bit bulky, huh?
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: newWallet.id,
      action: 'amount_required',
      newStatus: String(amountRequiredHalford),
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: newWallet.id,
      action: 'status',
      newStatus: WalletStatus.new,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: newWallet.id,
      action: 'address',
      newStatus: address,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: newWallet.id,
      action: 'recipient',
      newStatus: recipient,
    });

    return newWallet;
  }
}

export const WalletsCreatorService = new WalletsCreatorServiceClass();
