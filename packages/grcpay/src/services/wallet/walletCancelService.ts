import { Wallet, WalletStatus } from '../../models/Wallet';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';

export class WalletCancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletCancelError';
  }
}

/**
 * Flips a `new` wallet straight to `expired` so the existing
 * expired-refund flow returns any partial balance on the next cycle.
 * Rejects anything past `new`: `funded` is already the merchant's
 * money, and terminal states are already resolved.
 */
export class WalletCancelServiceClass {
  constructor(
    private wallet = new Wallet(),
  ) {}

  public async cancelWallet(wallet: Wallet): Promise<void> {
    if (wallet.status !== WalletStatus.new) {
      throw new WalletCancelError(
        `Wallet ${wallet.address} is in status ${wallet.status} — only 'new' wallets can be cancelled`,
      );
    }

    log.info(`Merchant-initiated cancellation of wallet ${wallet.address}`);
    await this.wallet.model.update({
      where: { id: wallet.id! },
      data: { status: WalletStatus.expired },
    });

    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: wallet.id!,
      action: 'status',
      oldStatus: WalletStatus.new,
      newStatus: WalletStatus.expired,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId: wallet.id!,
      action: 'cancelled',
      newStatus: 'merchant',
    });
  }
}

export const WalletCancelService = new WalletCancelServiceClass();
