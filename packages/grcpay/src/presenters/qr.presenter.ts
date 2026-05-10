import yayson from 'yayson';
import { Wallet } from '../models/Wallet';
import { Attributes } from './types';

const { Presenter } = yayson();

export class QrPresenter extends Presenter {
  public static type = 'qrs';

  public selfLinks(instance: Wallet): string {
    return `/wallets/${this.id(instance)}/qr`;
  }

  public attributes(instanse: Wallet): Attributes {
    return {
      qr: instanse.qr,
    };
  }

  public id(instance: Wallet): string {
    return instance.address;
  }
}
