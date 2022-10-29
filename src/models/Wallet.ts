import { wallets, WalletStatus } from '@prisma/client';
import { getPrisma } from '../lib/prisma';
import { GenericInterface } from './Generic';

export class Wallet implements GenericInterface {
  public id?: BigInt;

  public createdAt?: Date;

  public updatedAt?: Date;

  public address: string;

  public recipient: string;

  public amountRequired: BigInt;

  public amountRecieved: BigInt;

  public txOut?: string;

  public status: WalletStatus;

  public qr?: string;

  public attributes = [
    'id',
    'createdAt',
    'updatedAt',
    'attributes',
    'address',
    'recipient',
    'amountRequired',
    'amountRecieved',
    'status',
  ];

  public static fromModel(wallet: wallets): Wallet {
    const walletObj = new Wallet();
    walletObj.address = wallet.address;
    walletObj.amountRecieved = wallet.amount_recieved;
    walletObj.amountRequired = wallet.amount_required;
    walletObj.createdAt = wallet.created_at;
    walletObj.id = wallet.id;
    walletObj.recipient = wallet.recipient;
    walletObj.status = wallet.status;
    walletObj.txOut = wallet.tx_out;
    walletObj.updatedAt = wallet.updated_at;
    return walletObj;
  }

  constructor(public model = getPrisma().wallets) {}
}
