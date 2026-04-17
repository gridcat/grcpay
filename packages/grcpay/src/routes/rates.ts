import { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { RatesService } from '../services/rates/ratesService';
import { ErrorModel } from '../models/Error';
import { ratesRateLimiter } from '../middleware/rateLimit';

export const ratesRouter = Router();

// Rates is its own bucket — merchants polling for display purposes
// shouldn't have to share budget with the wallet endpoints.
ratesRouter.use(ratesRateLimiter);

// GET /rates/:currency — returns GRC price in the given fiat currency
ratesRouter.get('/:currency', async (req: Request, res: Response) => {
  try {
    const currency = String(req.params.currency).toLowerCase();
    const rate = await RatesService.getRate(currency);

    res.status(StatusCodes.OK).send({
      data: {
        type: 'rates',
        id: currency,
        attributes: {
          currency,
          rate,
          coin: 'gridcoin-research',
          ticker: 'grc',
        },
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(StatusCodes.BAD_REQUEST).send({
      errors: [new ErrorModel(StatusCodes.BAD_REQUEST, message)],
    });
  }
});

// GET /rates — returns list of supported currencies
ratesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const currencies = await RatesService.getSupportedCurrencies();

    res.status(StatusCodes.OK).send({
      data: {
        type: 'currencies',
        id: 'supported',
        attributes: {
          currencies,
        },
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).send({
      errors: [new ErrorModel(StatusCodes.INTERNAL_SERVER_ERROR, message)],
    });
  }
});
