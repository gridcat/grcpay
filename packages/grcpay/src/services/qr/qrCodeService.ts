import QRCode, { QRCodeToDataURLOptions } from 'qrcode';
import { halford2grc } from '../../lib/nomination';
import { Wallet } from '../../models/Wallet';

/**
 * Encodes the wallet address as a BIP21-style payment URI so that
 * scanning the QR in a Gridcoin wallet pre-fills the exact remaining
 * amount. If the wallet is fully paid (or overpaid), the URI omits the
 * `amount` parameter — a customer who somehow scans a fully-settled
 * wallet still gets a valid "pay to this address" QR without being
 * told to pay 0 or a negative amount.
 *
 *   new / partially funded:    grc:ADDRESS?amount=<required-received>
 *   funded / processed / …:    grc:ADDRESS
 */
export class QrCodeServiceClass {
  public async generateQrCode(wallet: Wallet, width = 300): Promise<string> {
    const remainingHalford = wallet.amountRequired.valueOf() - wallet.amountRecieved.valueOf();
    let uri: string;
    if (remainingHalford > BigInt(0)) {
      const left2pay = halford2grc(remainingHalford);
      uri = `grc:${wallet.address}?amount=${left2pay}`;
    } else {
      uri = `grc:${wallet.address}`;
    }
    const options: QRCodeToDataURLOptions = {
      width,
    };
    return QRCode.toDataURL(uri, options);
  }
}

export const QrCodeService = new QrCodeServiceClass();
