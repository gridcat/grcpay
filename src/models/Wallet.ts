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

  constructor(public model = getPrisma().wallets) {}
}
