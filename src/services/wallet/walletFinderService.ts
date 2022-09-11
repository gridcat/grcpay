import { Wallet } from '../../models/Wallet';

export class WalletsFinderServiceClass {
  constructor(
    private wallet = new Wallet(),
  ) {}

  public async findWalletByAddress(address: string) {
    if (!address) {
      throw new Error('Address is required');
    }
    return this.wallet.model.findFirst({
      where: {
        address,
      },
    });
  }
}

export const WalletsFinderService = new WalletsFinderServiceClass();
