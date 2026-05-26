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
import { WalletsService } from '../services/wallet/walletsService';
import { WalletStatus } from '../models/Wallet';
import { config } from '../config';

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
   *
   * For `confirming` wallets only, also resolve the live
   * confirmation depth of the indexed deposits so the integrator can
   * render "N of M confirmations". Skipped in any other status —
   * confirmation depth has no meaning for `new` (no funds yet) or
   * `funded`/later (already past threshold).
   */
  public async renderWallet(wallet: Wallet): Promise<void> {
    if (wallet.status === WalletStatus.confirming && wallet.id !== undefined) {
      // confirmations / confirmationsRequired are documented as a
      // pair — only surface them together. If getMinConfirmations
      // returns null (nothing indexed yet, or every getTransaction
      // RPC failed), the integrator falls back to the generic
      // "awaiting confirmations" copy rather than rendering a
      // misleading "? of 3" banner.
      const depth = await WalletsService.getMinConfirmations(wallet.id);
      if (depth !== null) {
        wallet.confirmations = depth;
        wallet.confirmationsRequired = config.MIN_CONFIRMATIONS;
      }
    }
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
      data.webhookUrl,
    );

    this.res
      .status(StatusCodes.CREATED)
      .send(this.render<Wallet>(result));
  }
}
