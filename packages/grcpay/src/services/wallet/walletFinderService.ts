import { Wallet } from '../../models/Wallet';

export class WalletsFinderServiceClass {
  constructor(
    private wallet = new Wallet(),
  ) {}

  public async findWalletByAddress(address: string): Promise<Wallet> {
    if (!address) {
      throw new Error('Address is required');
    }
    const result = await this.wallet.model.findFirst({
      where: {
        address,
      },
    });
    if (!result) {
      throw new Error(`Wallet not found for address: ${address}`);
    }
    return Wallet.fromModel(result);
  }
}

export const WalletsFinderService = new WalletsFinderServiceClass();
