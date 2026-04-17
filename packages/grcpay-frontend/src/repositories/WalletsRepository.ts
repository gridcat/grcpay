import axios from 'axios';
import yayson from 'yayson';
import { WalletEntity, WalletRawData } from '@/entities/WalletEntity';

const { Store } = yayson();

export interface CreateWalletAttrs {
  amountRequired: number;
  recipient?: string;
}

export class WalletsRepository {
  public constructor(
    private readonly httpClient = axios,
  ) {}

  public async createWallet(attrs: CreateWalletAttrs): Promise<WalletEntity | null> {
    const body = {
      data: {
        type: 'wallets',
        attributes: {
          amountRequired: attrs.amountRequired,
          ...(attrs.recipient ? { recipient: attrs.recipient } : {}),
        },
      },
    };
    const { data: result } = await this.httpClient.post(
      `${process.env.NEXT_PUBLIC_API_URL}/wallets`,
      body,
      { headers: { 'Content-Type': 'application/vnd.api+json' } },
    );
    const store = new Store();
    const parsed = store.sync(result) as WalletRawData | null;
    return parsed ? new WalletEntity(parsed) : null;
  }

  /**
   * Authenticated read of a wallet. `GET /wallets/:address` requires
   * the per-wallet token (returned once on the POST response) in the
   * `X-Wallet-Token` header — GRCpay rejects anonymous reads since the
   * wallet record exposes amounts and refund txids that shouldn't be
   * publicly scrapable.
   */
  public async getWallet(address: string, token: string): Promise<WalletEntity | null> {
    const { data: result } = await this.httpClient.get(
      `${process.env.NEXT_PUBLIC_API_URL}/wallets/${address}`,
      { headers: { 'X-Wallet-Token': token } },
    );
    const store = new Store();
    const parsed = store.sync(result) as WalletRawData | null;
    if (!parsed) return null;
    const entity = new WalletEntity(parsed);
    // The server never echoes `token` back on a GET. Restore it on
    // the entity so callers can keep polling without having to thread
    // the token through every call site manually.
    entity.token = token;
    return entity;
  }

  /**
   * Merchant-initiated cancellation. Flips a `new` wallet to
   * `expired` so the existing refund flow returns any partial balance
   * on the next job cycle. Requires the same token as getWallet. The
   * server responds 204 on success, 409 if the wallet is past `new`,
   * 401 on a bad or missing token, 404 if the address is unknown.
   */
  public async cancelWallet(address: string, token: string): Promise<void> {
    await this.httpClient.delete(
      `${process.env.NEXT_PUBLIC_API_URL}/wallets/${address}`,
      { headers: { 'X-Wallet-Token': token } },
    );
  }

  public getQrUrl(address: string, width = 256): string {
    return `${process.env.NEXT_PUBLIC_API_URL}/wallets/${address}/qr?filter[width]=${width}`;
  }

  /**
   * Fetches the QR endpoint and returns the embedded base64 data URL.
   * The /qr route serves JSON:API with a `qr` attribute that already
   * contains a `data:image/png;base64,...` string — drop it straight
   * into an <img src=...>.
   */
  public async getQrDataUrl(address: string, width = 256): Promise<string | null> {
    const { data: result } = await this.httpClient.get(
      this.getQrUrl(address, width),
    );
    const store = new Store();
    const parsed = store.sync(result) as { qr?: string } | null;
    return parsed?.qr ?? null;
  }
}
