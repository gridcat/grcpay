import { DbLogServiceClass, DbLogMessage } from '../../../src/services/dbLog/dbLogService';
import { createMockEventEmitter } from '../../helpers/mocks';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll } from '../../helpers/db';

describe('DbLogService', () => {
  let service: DbLogServiceClass;
  let mockEmitter: ReturnType<typeof createMockEventEmitter>;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
    mockEmitter = createMockEventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DbLogServiceClass(mockEmitter as any);
  });

  it('registers an event listener on "log"', () => {
    service.registerEventListener();

    expect(mockEmitter.on).toHaveBeenCalledWith('log', expect.any(Function));
  });

  it('writes log entries to the database when event fires', async () => {
    service.registerEventListener();

    const message: DbLogMessage = {
      walletId: 42,
      action: 'status',
      oldStatus: 'new',
      newStatus: 'funded',
    };
    mockEmitter.emit('log', message);
    await new Promise((r) => setTimeout(r, 20));

    const rows = await db.selectFrom('db_logs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wallet_id: BigInt(42),
      action: 'status',
      old_status: 'new',
      new_status: 'funded',
    });
  });

  it('handles optional fields', async () => {
    service.registerEventListener();

    mockEmitter.emit('log', { walletId: 1 });
    await new Promise((r) => setTimeout(r, 20));

    const rows = await db.selectFrom('db_logs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wallet_id: BigInt(1),
      action: null,
      old_status: null,
      new_status: null,
    });
  });

  it('still attempts db insert when previous call succeeded', async () => {
    service.registerEventListener();

    mockEmitter.emit('log', { walletId: 1, action: 'first' });
    mockEmitter.emit('log', { walletId: 2, action: 'second' });
    await new Promise((r) => setTimeout(r, 50));

    const rows = await db.selectFrom('db_logs').selectAll().execute();
    expect(rows).toHaveLength(2);
  });
});
