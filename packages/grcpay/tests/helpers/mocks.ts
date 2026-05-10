/**
 * Factory functions for creating mocked dependencies used across tests.
 * Database access is no longer mocked — see tests/helpers/db.ts for
 * the real-SQLite-in-memory setup.
 */

export function createMockRpc() {
  return {
    getWalletInfo: jest.fn().mockResolvedValue({}),
    getNewAddress: jest.fn().mockResolvedValue('S1234567890abcdef1234567890abcdef12'),
    keyPoolRefill: jest.fn().mockResolvedValue(null),
    getReceivedByAddress: jest.fn().mockResolvedValue(0),
    setTXfee: jest.fn().mockResolvedValue(true),
    sendToAddress: jest.fn().mockResolvedValue('txid_abc123'),
    listTransactions: jest.fn().mockResolvedValue([]),
    getRawTransaction: jest.fn().mockResolvedValue({ vin: [], vout: [] }),
    validateAddress: jest.fn().mockResolvedValue({ isvalid: true }),
  };
}

export function createMockEventEmitter() {
  // eslint-disable-next-line @typescript-eslint/ban-types
  const listeners = new Map<string, Function[]>();
  return {
    // eslint-disable-next-line @typescript-eslint/ban-types
    on: jest.fn((event: string, cb: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
    }),
    emit: jest.fn((event: string, data: unknown) => {
      (listeners.get(event) || []).forEach((cb) => cb(data));
    }),
    _listeners: listeners,
  };
}
