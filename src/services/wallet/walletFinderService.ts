import { Wallet } from '../../models/Wallet';

export class WalletsFinderServiceClass {
  constructor(
    private wallet = new Wallet(),
  ) {}

  public async findWalletByAddress(address: string): Promise<Wallet> {
    if (!address) {
      throw new Error('Address is required');
    }
    return Wallet.fromModel(await this.wallet.model.findFirst({
      where: {
        address,
      },
    }));
  }
}

export const WalletsFinderService = new WalletsFinderServiceClass();
