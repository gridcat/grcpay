import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { Request, Response } from 'express';
import { Controller } from './BaseController';
import { Wallet } from '../models/Wallet';
import { ErrorModel } from '../models/Error';
import { WalletsFinderService } from '../services/wallet/walletFinderService';
import { QrCodeService } from '../services/qr/qrCodeService';
import { QrPresenter } from '../presenters/qr.presenter';

export class QrController extends Controller {
  constructor(
    req: Request,
    res: Response,
    private walletFinderService = WalletsFinderService,
    private qrService = QrCodeService,
  ) {
    super(req, res);
    this.presenter = QrPresenter;
    this.model = new Wallet();
    this.init();
  }

  public async getQrByAddress(address: string): Promise<void> {
    const { width } = this.useFilters;
    try {
      const wallet = await this.walletFinderService.findWalletByAddress(address);
      let qrWidth: number | undefined;
      if (Number(width) && width > 0 && width < 1000) {
        qrWidth = Number(width);
      }
      const qrCodeString = await this.qrService.generateQrCode(wallet, qrWidth);
      wallet.qr = qrCodeString;
      this.res
        .status(StatusCodes.OK)
        .send(this.render<Wallet>(wallet));
    } catch (e: unknown) {
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
}
