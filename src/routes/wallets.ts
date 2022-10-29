import { Request, Response, Router } from 'express';
import { QrController } from '../controllers/QrController';
import { WalletController } from '../controllers/WalletController';

export const walletsRouter = Router();

walletsRouter.get('/:id/qr', async (req: Request, res: Response) => {
  const controller = new QrController(req, res);
  return controller.getQrByAddress(req.params.id);
});

walletsRouter.get('/:id', async (req: Request, res: Response) => {
  const controller = new WalletController(req, res);
  return controller.getByAddress(req.params.id);
});

walletsRouter.post('/', async (req: Request, res: Response) => {
  const controller = new WalletController(req, res);
  return controller.createWallet(req.body);
});
