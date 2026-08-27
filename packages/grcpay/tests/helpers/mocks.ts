/**
 * Factory functions for creating mocked dependencies used across tests.
 * Database access is no longer mocked — see tests/helpers/db.ts for
 * the real-SQLite-in-memory setup.
 */
import { vi } from 'vitest';

export function createMockRpc() {
  return {
    // `balance` is the daemon's GetBalance() — the figure sendtoaddress
    // pre-checks before it will spend anything, and what the funded
    // processor gates the merchant forward on. Default is comfortably
    // above every amount the suite uses so the gate is a no-op unless
    // overridden.
    getWalletInfo: vi.fn().mockResolvedValue({ balance: 1_000_000 }),
    getNewAddress: vi.fn().mockResolvedValue('S1234567890abcdef1234567890abcdef12'),
    keyPoolRefill: vi.fn().mockResolvedValue(null),
    getReceivedByAddress: vi.fn().mockResolvedValue(0),
    setTXfee: vi.fn().mockResolvedValue(true),
    sendToAddress: vi.fn().mockResolvedValue('txid_abc123'),
    sendMany: vi.fn().mockResolvedValue('txid_sendmany_abc123'),
    listTransactions: vi.fn().mockResolvedValue([]),
    getRawTransaction: vi.fn().mockResolvedValue({ vin: [], vout: [] }),
    // Default to "deeply confirmed" so refund tests that don't care
    // about confirmation depth behave as before. Tests exercising the
    // 0-conf drain/redirect guard override this per-txid.
    //
    // `fee` is NEGATIVE, matching the daemon: gettransaction computes
    // `nFee = wtx.GetValueOut() - nDebit` and pushes it unnegated
    // (rpcwallet.cpp). The fee ledger normalises with Math.abs; a mock
    // that returned a positive fee would hide a sign bug.
    getTransaction: vi.fn().mockResolvedValue({ confirmations: 999, fee: -0.001 }),
    // NOT what the forward gates on — see getWalletInfo above.
    listUnspent: vi.fn().mockResolvedValue([]),
    createRawTransaction: vi.fn().mockResolvedValue('00'.repeat(96)),
    signRawTransaction: vi.fn().mockResolvedValue({
      hex: '00'.repeat(192),
      complete: true,
    }),
    sendRawTransaction: vi.fn().mockResolvedValue('txid_raw_abc123'),
    // `ismine` matters to the consolidation sweep, which refuses to
    // send the operator float to an address this wallet does not
    // control. Default to a wallet-owned address; the refusal path
    // overrides it per-test.
    validateAddress: vi.fn().mockResolvedValue({ isvalid: true, ismine: true }),
  };
}

export function createMockEventEmitter() {
  // eslint-disable-next-line @typescript-eslint/ban-types
  const listeners = new Map<string, Function[]>();
  return {
    // eslint-disable-next-line @typescript-eslint/ban-types
    on: vi.fn((event: string, cb: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
    }),
    emit: vi.fn((event: string, data: unknown) => {
      (listeners.get(event) || []).forEach((cb) => cb(data));
    }),
    _listeners: listeners,
  };
}
