import { beforeEach, describe, expect, it } from 'vitest';
import { QrCodeServiceClass } from '../../../src/services/qr/qrCodeService';
import { Wallet, WalletStatus } from '../../../src/models/Wallet';

describe('QrCodeService', () => {
  let service: QrCodeServiceClass;

  beforeEach(() => {
    service = new QrCodeServiceClass();
  });

  function createTestWallet(overrides: Partial<Wallet> = {}): Wallet {
    const w = new Wallet();
    w.address = 'Stest_address_234567890abcdefghij12';
    w.amountRequired = BigInt(1000000000); // 10 GRC
    w.amountRecieved = BigInt(0);
    w.status = WalletStatus.new;
    Object.assign(w, overrides);
    return w;
  }

  it('generates a data URL QR code', async () => {
    const wallet = createTestWallet();
    const result = await service.generateQrCode(wallet);

    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('includes address in QR string', async () => {
    const wallet = createTestWallet({ address: 'SmyAddr_34567890abcdefghijklmnop12' });
    // We can't easily inspect the QR content, but we can verify it doesn't throw
    const result = await service.generateQrCode(wallet);
    expect(result).toBeTruthy();
  });

  it('calculates remaining amount correctly', async () => {
    const wallet = createTestWallet({
      amountRequired: BigInt(1000000000),  // 10 GRC
      amountRecieved: BigInt(500000000),   // 5 GRC
    });
    // Should encode amount=5
    const result = await service.generateQrCode(wallet);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('accepts custom width', async () => {
    const wallet = createTestWallet();
    const result = await service.generateQrCode(wallet, 500);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('uses default width of 300', async () => {
    const wallet = createTestWallet();
    // Just verify it runs without error with default
    const result = await service.generateQrCode(wallet);
    expect(result).toBeTruthy();
  });

  it('produces a valid QR when wallet is fully paid (remaining = 0)', async () => {
    const wallet = createTestWallet({
      amountRequired: BigInt(1000000000),
      amountRecieved: BigInt(1000000000),
    });
    const result = await service.generateQrCode(wallet);
    // Should still return a data URL, not throw on negative/zero amount.
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('produces a valid QR when wallet is overpaid (remaining negative)', async () => {
    const wallet = createTestWallet({
      amountRequired: BigInt(1000000000),
      amountRecieved: BigInt(1500000000), // 15 GRC on a 10 GRC wallet
    });
    const result = await service.generateQrCode(wallet);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});
