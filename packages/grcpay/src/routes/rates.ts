import { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { RatesService, UnsupportedCurrencyError } from '../services/rates/ratesService';
import { ErrorModel } from '../models/Error';
import { ratesRateLimiter } from '../middleware/rateLimit';
import { log } from '../lib/log';

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
    // Don't echo the upstream/axios message to the client (it leaks
    // CoinGecko/infra detail): log it server-side and classify.
    log.warn(`Rate lookup failed for '${req.params.currency}': ${e}`);

    if (e instanceof UnsupportedCurrencyError) {
      res.status(StatusCodes.BAD_REQUEST).send({
        errors: [new ErrorModel(
          StatusCodes.BAD_REQUEST,
          'Currency not supported',
        )],
      });
      return;
    }

    // Upstream is down or rate-limiting us and there's no cached quote
    // left to serve. That's ours, not the caller's. Reporting it as a
    // 400 made routine CoinGecko blips look like integration bugs.
    res.status(StatusCodes.SERVICE_UNAVAILABLE).send({
      errors: [new ErrorModel(
        StatusCodes.SERVICE_UNAVAILABLE,
        'Rates are temporarily unavailable',
      )],
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
    log.error(`Supported-currencies lookup failed: ${e}`);
    res.status(StatusCodes.SERVICE_UNAVAILABLE).send({
      errors: [new ErrorModel(
        StatusCodes.SERVICE_UNAVAILABLE,
        'Rates are temporarily unavailable',
      )],
    });
  }
});
