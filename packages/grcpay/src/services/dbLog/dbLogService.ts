import { getEventEmitter } from '../../lib/event';
import { db, now } from '../../lib/db';
import { log } from '../../lib/log';

export interface DbLogMessage {
  walletId: number;
  action?: string;
  oldStatus?: string;
  newStatus?: string;
  // Free-text reason, mainly the failure cause on an `error` flip
  // (e.g. the rejected-tx message from a failed merchant forward).
  detail?: string;
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
      await db
        .insertInto('db_logs')
        .values({
          wallet_id: BigInt(data.walletId),
          action: data.action ?? null,
          old_status: data.oldStatus ?? null,
          new_status: data.newStatus ?? null,
          detail: data.detail ?? null,
          created_at: now(),
        })
        .execute();
    } catch (e) {
      log.error(`Can not insert the record in DbLog: ${JSON.stringify(data)}`);
      throw (e);
    }
  }
}

export const DbLogService = new DbLogServiceClass();
