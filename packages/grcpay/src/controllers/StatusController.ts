import { StatusCodes } from 'http-status-codes';
import { Request, Response } from 'express';
import { ErrorModel } from '../models/Error';
import { StatusPresenter } from '../presenters/status.presenter';
import { PresenterInterface } from '../presenters/types';
import { RatesService } from '../services/rates/ratesService';

export interface ServiceInfo {
  name: string,
  version: string,
}

export class StatusController {
  private presenter: PresenterInterface;

  private model: typeof ErrorModel;

  protected req: Request;

  protected res: Response;

  constructor(req: Request, res: Response) {
    this.presenter = StatusPresenter;
    this.model = ErrorModel;
    this.req = req;
    this.res = res;
  }

  public getStatus(serviceInfo: ServiceInfo): void {
    const errors: ErrorModel[] = [];
    if (!errors.length) {
      // Rates health rides along here rather than on its own endpoint:
      // /status is what the control panel already polls, and a stalled
      // CoinGecko feed doesn't make the service itself unhealthy, so
      // this stays a 200 with a flag rather than flipping to 5xx.
      this.res
        .status(StatusCodes.OK)
        .send(this.presenter.render({ ...serviceInfo, rates: RatesService.getHealth() }));
    } else {
      this.res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send({ errors });
    }
  }
}
