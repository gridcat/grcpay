import { Request, Response, Router } from 'express';
import { WalletController } from '../controllers/WalletController';

export const walletsRouter = Router();

// stampsRouter.get('/', async (req: Request, res: Response) => {
//   const controller = new StampsController(req, res);
//   return controller.listStamps();
// });

walletsRouter.get('/:id', async (req: Request, res: Response) => {
  const controller = new WalletController(req, res);
  return controller.getByAddress(req.params.id);
});

walletsRouter.post('/', async (req: Request, res: Response) => {
  const controller = new WalletController(req, res);
  return controller.createWallet(req.body);
});
