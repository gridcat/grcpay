import { wallets } from '@prisma/client';
import yayson from 'yayson';
import { Wallet } from '../models/Wallet';
import { Attributes } from './types';

const { Presenter } = yayson();

export class QrPresenter extends Presenter {
  public selfLinks(instance: wallets): string {
    return `/wallets/${this.id(instance)}/qr`;
  }

  public attributes(instanse: Wallet): Attributes {
    return {
      qr: instanse.qr,
    };
  }

  public id(instance: wallets): string {
    return instance.address;
  }
}

QrPresenter.prototype.type = 'qrs';
