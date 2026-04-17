import { Wallet, WalletMode, WalletStatus } from '../../models/Wallet';
import { rpc } from '../../lib/gridcoin';
import { log } from '../../lib/log';
import { getEventEmitter } from '../../lib/event';
import { DbLogMessage } from '../dbLog/dbLogService';
import { grc2halford } from '../../lib/nomination';
import { generateToken, hashToken } from '../../lib/walletToken';

export class WalletsCreatorServiceClass {
  constructor(
    private wallet = new Wallet(),
    private grcRpc = rpc,
  ) {}

  public async createWallet(
    amountRequired: number,
    recipient?: string,
    mode: WalletMode = WalletMode.checkout,
    lifespanSeconds?: number,
  ) {
    if (!amountRequired) {
      throw new Error('Required amount is required');
    }

    // Preflight: if the caller supplied a forwarding recipient, ask
    // the wallet daemon to validate it BEFORE we mint a payment
    // address. Catches:
    //   * mainnet address configured on a testnet daemon (or vice
    //     versa) — different version byte, fails the checksum
    //   * malformed base58 that passed the Joi regex but isn't a
    //     real Gridcoin address
    //   * typos
    //
    // Without this, the error only surfaces at forwarding time
    // (minutes later, after the customer has paid) when the funded
    // processor's sendToAddress throws "Invalid Gridcoin address"
    // and flips the wallet to status=error. Recovery requires
    // operator DB surgery to fix the recipient and reset the
    // status. Failing fast at creation time turns the same bug
    // into an HTTP 400 the merchant sees immediately.
    if (recipient) {
      let validation;
      try {
        validation = await this.grcRpc.validateAddress(recipient);
      } catch (e) {
        throw new Error(`Failed to validate recipient address: ${e}`);
      }
      if (!validation.isvalid) {
        throw new Error(`Recipient ${recipient} is not a valid Gridcoin address for this network`);
      }
    }

    // generate new payment address
    let address: string;
    try {
      address = await this.grcRpc.getNewAddress();
    } catch (e) {
      log.warn(`Failed to get new address, refilling keypool: ${e}`);
      await this.grcRpc.keyPoolRefill(100);
      address = await this.grcRpc.getNewAddress();
    }

    if (!address.length) {
      throw new Error('Unable to generate new address');
    }

    const amountRequiredHalford = grc2halford(amountRequired);

    // One-time token reveal: generate once, hash for storage, stash the
    // raw value on the Wallet instance so the presenter can include it
    // in the POST response. Subsequent loads via fromModel leave
    // `token` undefined so GETs never echo it back.
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);

    const newWallet = Wallet.fromModel(await this.wallet.model.create({
      data: {
        amount_required: amountRequiredHalford.valueOf(),
        amount_recieved: 0,
        status: WalletStatus.new,
        address,
        recipient,
        mode,
        lifespan_seconds: lifespanSeconds ?? null,
        token_hash: tokenHash,
      },
    }));
    newWallet.token = rawToken;

    const walletId = newWallet.id!;
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'amount_required',
      newStatus: String(amountRequiredHalford),
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'status',
      newStatus: WalletStatus.new,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'address',
      newStatus: address,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'recipient',
      newStatus: recipient,
    });
    getEventEmitter<DbLogMessage>().emit('log', {
      walletId,
      action: 'mode',
      newStatus: mode,
    });
    if (lifespanSeconds != null) {
      getEventEmitter<DbLogMessage>().emit('log', {
        walletId,
        action: 'lifespan_seconds',
        newStatus: String(lifespanSeconds),
      });
    }

    return newWallet;
  }
}

export const WalletsCreatorService = new WalletsCreatorServiceClass();
