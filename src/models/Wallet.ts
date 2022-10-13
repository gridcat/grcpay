import { WalletStatus } from '@prisma/client';
import { getPrisma } from '../lib/prisma';
import { GenericInterface } from './Generic';

export class Wallet implements GenericInterface {
  public id?: number;

  public createdAt?: Date;

  public updatedAt?: Date;

  public address: string;

  public recipient: string;

  public amountRequired: number;

  public amountRecieved: number;

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

  public fromModel(): void {

  }

  constructor(public model = getPrisma().wallets) {}
}
