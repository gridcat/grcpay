import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { Request, Response } from 'express';
import { Controller } from './BaseController';
import { Wallet } from '../models/Wallet';
import { ErrorModel } from '../models/Error';
import { WalletsFinderService } from '../services/wallet/walletFinderService';
import { QrCodeService } from '../services/qr/qrCodeService';
import { QrPresenter } from '../presenters/qr.presenter';
import { GRC_ADDRESS_PATTERN } from '../lib/address';

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
    if (!GRC_ADDRESS_PATTERN.test(address)) {
      this.res
        .status(StatusCodes.BAD_REQUEST)
        .send({
          errors: [
            new ErrorModel(
              StatusCodes.BAD_REQUEST,
              getReasonPhrase(StatusCodes.BAD_REQUEST),
            ),
          ],
        });
      return;
    }

    const width = this.useFilters.width as string | undefined;
    let qrWidth: number | undefined;
    const widthNum = Number(width);
    if (widthNum && widthNum > 0 && widthNum < 1000) {
      qrWidth = widthNum;
    }

    // Unknown addresses fall through to a plain `grc:ADDRESS` QR with
    // 200 OK — a 404 here would let a caller probe whether a known
    // on-chain address was ever minted by this grcpay instance.
    let wallet: Wallet | null = null;
    try {
      wallet = await this.walletFinderService.findWalletByAddress(address);
    } catch {
      wallet = null;
    }

    let qrCodeString: string;
    let response: Wallet;
    if (wallet) {
      qrCodeString = await this.qrService.generateQrCode(wallet, qrWidth);
      wallet.qr = qrCodeString;
      response = wallet;
    } else {
      qrCodeString = await this.qrService.generatePlainAddressQrCode(address, qrWidth);
      const synthetic = new Wallet();
      synthetic.address = address;
      synthetic.qr = qrCodeString;
      response = synthetic;
    }

    this.res
      .status(StatusCodes.OK)
      .send(this.render<Wallet>(response));
  }
}
