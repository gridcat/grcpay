import { Request, Response, NextFunction } from 'express';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { ErrorModel } from '../models/Error';
import { WalletsFinderService } from '../services/wallet/walletFinderService';
import { tokenMatches } from '../lib/walletToken';
import { Wallet } from '../models/Wallet';

type LocalsWithWallet = Record<string, unknown> & { wallet?: Wallet };

function unauthorized(res: Response, message?: string): void {
  res
    .status(StatusCodes.UNAUTHORIZED)
    .send({
      errors: [
        new ErrorModel(
          StatusCodes.UNAUTHORIZED,
          message || getReasonPhrase(StatusCodes.UNAUTHORIZED),
        ),
      ],
    });
}

export async function requireWalletToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const address = String(req.params.id);

  const headerValue = req.headers['x-wallet-token'];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!token) {
    unauthorized(res, 'Invalid wallet token');
    return;
  }

  // Deliberately indistinguishable from "token mismatch" below:
  // "the address exists but your token is wrong" and "the address
  // doesn't exist at all" must return the same status and body, or
  // an attacker gets a probe oracle to verify whether a specific
  // address is live on this grcpay instance without needing a
  // token. See Wallets.tsx in the docs site for the threat model.
  let wallet: Wallet;
  try {
    wallet = await WalletsFinderService.findWalletByAddress(address);
  } catch {
    unauthorized(res, 'Invalid wallet token');
    return;
  }

  if (!tokenMatches(token, wallet.tokenHash)) {
    unauthorized(res, 'Invalid wallet token');
    return;
  }

  (res.locals as LocalsWithWallet).wallet = wallet;
  next();
}
