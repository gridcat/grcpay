import QRCode from 'qrcode';

// grc:wallet?amount=1

export class QrCodeService {
  public async generateQrCode(address: string, amount: number): Promise<string> {
    const string = `grc:${address}?amount=${amount}`;
    return QRCode.toDataURL(string);
  }
}
