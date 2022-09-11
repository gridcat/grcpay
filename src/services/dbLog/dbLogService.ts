import { getEventEmitter } from '../../lib/event';
import { getPrisma } from '../../lib/prisma';
import { log } from '../../lib/log';

export interface DbLogMessage {
  walletId: bigint;
  action?: string;
  oldStatus?: string;
  newStatus?: string;
}

export class DbLogServiceClass {
  constructor(
    private eventEmitter = getEventEmitter<DbLogMessage>(),
  ) {}

  public registerEventListener() {
    this.eventEmitter.on('log', this.logInDb);
  }

  private async logInDb(data: DbLogMessage) {
    try {
      await getPrisma().db_logs.create({
        data: {
          wallet_id: data.walletId,
          action: data.action,
          old_status: data.oldStatus,
          new_status: data.newStatus,
        },
      });
    } catch (e) {
      log.error(`Can not insert the record in DbLog: ${JSON.stringify(data)}`);
      throw (e);
    }
  }
}

export const DbLogService = new DbLogServiceClass();
