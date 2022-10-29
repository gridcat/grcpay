import { wallets } from '@prisma/client';
import yayson from 'yayson';
import { Wallet } from '../models/Wallet';
import { Attributes } from './types';

const { Presenter } = yayson();

export class WalletPresenter extends Presenter {
  public selfLinks(instance: wallets): string {
    return `/wallets/${this.id(instance)}`;
  }

  public attributes(instanse: Wallet): Attributes {
    return {
      address: instanse.address,
      recipient: instanse.recipient,
      amountRequired: (instanse.amountRequired).toString(),
      amountRecieved: instanse.amountRecieved.toString(),
      status: instanse.status,
      createdAt: instanse.createdAt,
      updatedAt: instanse.updatedAt,
    };
  }

  public id(instance: wallets): string {
    return instance.address;
  }
}

WalletPresenter.prototype.type = 'wallets';
