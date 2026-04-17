import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { Request, Response } from 'express';
import yayson from 'yayson';
import { Controller } from './BaseController';
import { WalletPresenter } from '../presenters/wallet.presenter';
import { Wallet } from '../models/Wallet';
import { WalletInput, WalletSchema, WalletData } from './schemas/WalletSchema';
import { ErrorModel } from '../models/Error';
import { WalletsCreatorService } from '../services/wallet/walletCreatorService';
import { WalletCancelService, WalletCancelError } from '../services/wallet/walletCancelService';

const { Store } = yayson();

export class WalletController extends Controller {
  constructor(
    req: Request,
    res: Response,
    private walletCreatorService = WalletsCreatorService,
  ) {
    super(req, res);
    this.presenter = WalletPresenter;
    this.model = new Wallet();
    this.init();
  }

  /**
   * Renders a pre-authenticated wallet. The auth middleware already
   * loaded the wallet by address and verified the token, so we just
   * serialize it here — no second DB fetch, no 404 branch.
   */
  public renderWallet(wallet: Wallet): void {
    this.res
      .status(StatusCodes.OK)
      .send(this.render<Wallet>(wallet));
  }

  public async cancelByAddress(wallet: Wallet): Promise<void> {
    try {
      await WalletCancelService.cancelWallet(wallet);
      this.res.status(StatusCodes.NO_CONTENT).send();
    } catch (e) {
      if (e instanceof WalletCancelError) {
        this.res
          .status(StatusCodes.CONFLICT)
          .send({
            errors: [
              new ErrorModel(
                StatusCodes.CONFLICT,
                e.message,
              ),
            ],
          });
        return;
      }
      this.res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send({
          errors: [
            new ErrorModel(
              StatusCodes.INTERNAL_SERVER_ERROR,
              getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR),
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
      const result = WalletSchema.validate(data);
      if (result.error && result.error.details) {
        throw new Error(result.error.details[0].message);
      }
    } catch (_e: unknown) {
      const message = _e instanceof Error ? _e.message : undefined;
      this.res
        .status(StatusCodes.BAD_REQUEST)
        .send({
          errors: [
            new ErrorModel(
              StatusCodes.BAD_REQUEST,
              message || getReasonPhrase(StatusCodes.BAD_REQUEST),
            ),
          ],
        });
      return;
    }

    const result = await this.walletCreatorService.createWallet(
      Number(data.amountRequired),
      data.recipient,
      data.mode,
      data.lifespanSeconds,
    );

    this.res
      .status(StatusCodes.CREATED)
      .send(this.render<Wallet>(result));
  }
}
