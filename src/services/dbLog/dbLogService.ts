import { getEventEmitter } from '../../lib/event';
import { getPrisma } from '../../lib/prisma';

export interface DbLogMessage {
  walletId: number;
  action?: string;
  oldStatus?: string;
  newStatus?: string;
}

export class DbLogServiceClass {
  constructor(
    private dbLog = getPrisma().logs,
    private eventEmitter = getEventEmitter(),
  ) {}

  public registerEventListener() {
    this.eventEmitter.on('log', this.logInDb);
  }

  private logInDb(data: DbLogMessage) {
    this.dbLog.create({
      data: {
        wallet_id: BigInt(data.walletId),
        action: data.action,
        old_status: data.oldStatus,
        new_status: data.newStatus,
      },
    });
  }
}

export const DbLogService = new DbLogServiceClass();
