import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { Request, Response } from 'express';
import yayson from 'yayson';
import { wallets } from '@prisma/client';
import { Controller } from './BaseController';
import { WalletPresenter } from '../presenters/wallet.presenter';
import { Wallet } from '../models/Wallet';
import { WalletInput, WalletSchema, WalletData } from './schemas/WalletSchema';
import { ErrorModel } from '../models/Error';
import { WalletsFinderService } from '../services/wallet/walletFinderService';
import { WalletsCreatorService } from '../services/wallet/walletCreatorService';

const { Store } = yayson();

export class WalletController extends Controller {
  constructor(
    req: Request,
    res: Response,
    private walletFinderService = WalletsFinderService,
    private walletCreatorService = WalletsCreatorService,
  ) {
    super(req, res);
    this.presenter = WalletPresenter;
    this.model = new Wallet();
    this.init();
  }

  public async getByAddress(address: string): Promise<void> {
    const result = await this.walletFinderService.findWalletByAddress(address);
    if (result) {
      this.res
        .status(StatusCodes.OK)
        .send(this.render<wallets>(result));
    } else {
      this.res
        .status(StatusCodes.NOT_FOUND)
        .send({
          errors: [
            new ErrorModel(
              StatusCodes.NOT_FOUND,
              getReasonPhrase(StatusCodes.NOT_FOUND),
            ),
          ],
        });
    }
  }

  public async createWallet(input: WalletInput): Promise<void> {
    const store = new Store();
    let data: WalletData;

    try {
      data = store.sync(input);
      // console.log(data);
      const result = WalletSchema.validate(data);
      if (result.error && result.error.details) {
        throw new Error(result.error.details[0].message);
      }
    } catch (_e) {
      this.res
        .status(StatusCodes.BAD_REQUEST)
        .send({
          errors: [
            new ErrorModel(
              StatusCodes.BAD_REQUEST,
              _e.message
                ? _e.message
                : getReasonPhrase(StatusCodes.BAD_REQUEST),
            ),
          ],
        });
      return;
    }

    const result = await this.walletCreatorService.createWallet(
      Number(data.amountRequired),
      data.recipient,
    );

    this.res
      .status(StatusCodes.CREATED)
      .send(this.render<wallets>(result));
  }
}
