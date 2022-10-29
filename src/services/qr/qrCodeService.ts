import QRCode, { QRCodeToDataURLOptions } from 'qrcode';
import { halford2grc } from '../../lib/nomination';
import { Wallet } from '../../models/Wallet';

// grc:wallet?amount=1

export class QrCodeServiceClass {
  public async generateQrCode(wallet: Wallet, width = 300): Promise<string> {
    const left2pay = halford2grc(
      wallet.amountRequired.valueOf() - wallet.amountRecieved.valueOf(),
    );
    const string = `grc:${wallet.address}?amount=${left2pay}`;
    const options: QRCodeToDataURLOptions = {
      width,
    };
    return QRCode.toDataURL(string, options);
  }
}

export const QrCodeService = new QrCodeServiceClass();
