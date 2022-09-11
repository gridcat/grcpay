import { WalletStatus } from '@prisma/client';
import { Wallet } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';

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

    return this.wallet.model.create({
      data: {
        amount_required: amountRequired,
        amount_recieved: 0,
        status: WalletStatus.new,
        address,
        recipient,
      },
    });
  }
}

export const WalletsCreatorService = new WalletsCreatorServiceClass();
