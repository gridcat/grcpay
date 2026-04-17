import { DbLogServiceClass, DbLogMessage } from '../../../src/services/dbLog/dbLogService';
import { createMockEventEmitter } from '../../helpers/mocks';

// Mock prisma
const mockCreate = jest.fn().mockResolvedValue({});
jest.mock('../../../src/lib/prisma', () => ({
  getPrisma: () => ({
    db_logs: {
      create: mockCreate,
    },
  }),
}));

describe('DbLogService', () => {
  let service: DbLogServiceClass;
  let mockEmitter: ReturnType<typeof createMockEventEmitter>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter = createMockEventEmitter();
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

    // Trigger the event
    mockEmitter.emit('log', message);

    // Wait for the async handler
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        wallet_id: 42,
        action: 'status',
        old_status: 'new',
        new_status: 'funded',
      },
    });
  });

  it('handles optional fields', async () => {
    service.registerEventListener();

    const message: DbLogMessage = {
      walletId: 1,
    };

    mockEmitter.emit('log', message);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        wallet_id: 1,
        action: undefined,
        old_status: undefined,
        new_status: undefined,
      },
    });
  });

  it('still attempts db insert when previous call succeeded', async () => {
    service.registerEventListener();

    // Fire two events - both should call create
    mockEmitter.emit('log', { walletId: 1, action: 'first' });
    mockEmitter.emit('log', { walletId: 2, action: 'second' });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
