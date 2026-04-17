import { Request, Response, Router } from 'express';
import { QrController } from '../controllers/QrController';
import { WalletController } from '../controllers/WalletController';
import { requireWalletToken } from './walletAuth';
import { Wallet } from '../models/Wallet';
import {
  qrRateLimiter,
  walletCreateRateLimiter,
  walletDeleteRateLimiter,
  walletReadRateLimiter,
} from '../middleware/rateLimit';

export const walletsRouter = Router();

// Public: the QR image is intended to be embedded in a customer-facing
// checkout page via an <img> tag, which can't easily set custom
// headers. The image only encodes the wallet address and optional
// remaining amount — nothing that needs token protection.
walletsRouter.get('/:id/qr', qrRateLimiter, async (req: Request, res: Response) => {
  const controller = new QrController(req, res);
  return controller.getQrByAddress(String(req.params.id));
});

// Public: creation can't require a token that doesn't exist yet. The
// response includes the freshly minted token as a one-time reveal.
walletsRouter.post('/', walletCreateRateLimiter, async (req: Request, res: Response) => {
  const controller = new WalletController(req, res);
  return controller.createWallet(req.body);
});

// Auth-gated reads. The middleware loads the wallet, verifies the
// token, and stashes the loaded Wallet on res.locals — the controller
// just renders it.
walletsRouter.get(
  '/:id',
  walletReadRateLimiter,
  requireWalletToken,
  async (req: Request, res: Response) => {
    const controller = new WalletController(req, res);
    return controller.renderWallet(res.locals.wallet as Wallet);
  },
);

// Merchant-initiated cancellation. Same auth as GET. The service
// layer flips `new → expired` so the existing expired-refund flow
// returns any partial balance on the next job cycle.
walletsRouter.delete(
  '/:id',
  walletDeleteRateLimiter,
  requireWalletToken,
  async (req: Request, res: Response) => {
    const controller = new WalletController(req, res);
    return controller.cancelByAddress(res.locals.wallet as Wallet);
  },
);
