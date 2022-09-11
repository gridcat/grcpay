import { wallets } from '@prisma/client';
import yayson from 'yayson';
import { Attributes } from './types';

const { Presenter } = yayson();

export class WalletPresenter extends Presenter {
  public selfLinks(instance: wallets): string {
    return `/wallets/${this.id(instance)}`;
  }

  public attributes(instanse: wallets): Attributes {
    return {
      address: instanse.address,
      recipient: instanse.recipient,
      amountRequired: instanse.amount_required,
      amountRecieved: instanse.amount_recieved,
      status: instanse.status,
      createdAt: instanse.created_at,
      updatedAt: instanse.updated_at,
    };
  }

  public id(instance: wallets): string {
    return instance.address;
  }
}

WalletPresenter.prototype.type = 'wallets';
