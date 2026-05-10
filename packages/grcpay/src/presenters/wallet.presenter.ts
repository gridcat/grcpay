import yayson from 'yayson';
import { Wallet } from '../models/Wallet';
import { Attributes } from './types';

const { Presenter } = yayson();

export class WalletPresenter extends Presenter {
  public static type = 'wallets';

  public selfLinks(instance: Wallet): string {
    return `/wallets/${this.id(instance)}`;
  }

  public attributes(instanse: Wallet): Attributes {
    // `token` is only populated on the Wallet instance returned by
    // the creator service (one-time reveal on POST). fromRow leaves
    // it undefined, which drops it from the serialized JSON on GET
    // responses so the hash-only storage actually buys us something.
    return {
      address: instanse.address,
      recipient: instanse.recipient,
      amountRequired: (instanse.amountRequired).toString(),
      amountRecieved: instanse.amountRecieved.toString(),
      amountPending: instanse.amountPending.toString(),
      status: instanse.status,
      txOut: instanse.txOut ?? null,
      refundTx: instanse.refundTx ?? null,
      refundAmount: instanse.refundAmount ? instanse.refundAmount.toString() : null,
      mode: instanse.mode,
      lifespanSeconds: instanse.lifespanSeconds ?? null,
      token: instanse.token ?? undefined,
      createdAt: instanse.createdAt,
      updatedAt: instanse.updatedAt,
    };
  }

  public id(instance: Wallet): string {
    return instance.address;
  }
}
