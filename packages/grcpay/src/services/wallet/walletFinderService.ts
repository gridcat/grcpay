import { Wallet } from '../../models/Wallet';
import { db } from '../../lib/db';

export class WalletsFinderServiceClass {
  public async findWalletByAddress(address: string): Promise<Wallet> {
    if (!address) {
      throw new Error('Address is required');
    }
    const row = await db
      .selectFrom('wallets')
      .selectAll()
      .where('address', '=', address)
      .executeTakeFirst();
    if (!row) {
      throw new Error(`Wallet not found for address: ${address}`);
    }
    return Wallet.fromRow(row);
  }
}

export const WalletsFinderService = new WalletsFinderServiceClass();
