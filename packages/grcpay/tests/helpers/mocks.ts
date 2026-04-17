/**
 * Factory functions for creating mocked dependencies used across tests.
 */

export function createMockWalletModel() {
  return {
    model: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

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
  };
}

export function createMockEventEmitter() {
  const listeners = new Map<string, Function[]>();
  return {
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

/** A sample wallet DB row for use in tests */
export function createSampleWalletRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    address: 'S1234567890abcdef1234567890abcdef12',
    recipient: null,
    amount_required: BigInt(1000000000), // 10 GRC in halford
    amount_recieved: BigInt(0),
    status: 'new',
    tx_out: null,
    refund_tx: null,
    refund_amount: null,
    mode: 'checkout',
    lifespan_seconds: null,
    token_hash: 'deadbeef'.repeat(8), // fake sha256
    refund_attempts: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}
