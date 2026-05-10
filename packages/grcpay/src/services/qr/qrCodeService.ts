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
  private async renderQr(uri: string, width = 300): Promise<string> {
    const options: QRCodeToDataURLOptions = { width };
    return QRCode.toDataURL(uri, options);
  }

  public async generateQrCode(wallet: Wallet, width = 300): Promise<string> {
    const remainingHalford = wallet.amountRequired.valueOf() - wallet.amountRecieved.valueOf();
    const uri = remainingHalford > BigInt(0)
      ? `grc:${wallet.address}?amount=${halford2grc(remainingHalford)}`
      : `grc:${wallet.address}`;
    return this.renderQr(uri, width);
  }

  // Plain `grc:ADDRESS` QR for an address grcpay does not manage.
  // Lets the QR controller return an indistinguishable 200 OK for
  // unknown addresses, closing the status-code oracle on whether a
  // given address was ever minted by this grcpay instance.
  public async generatePlainAddressQrCode(address: string, width = 300): Promise<string> {
    return this.renderQr(`grc:${address}`, width);
  }
}

export const QrCodeService = new QrCodeServiceClass();
