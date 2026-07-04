import { findAllSenders, findSenderAddress } from '../../../src/services/wallet/senderLookup';
import { createMockRpc } from '../../helpers/mocks';
import { config } from '../../../src/config';
import { setupTestDb, truncateAll } from '../../helpers/db';

// These tests pin the confirmation discipline that keeps refunds from
// paying out unconfirmed (double-spendable) deposits (the drain) and
// from letting a later 0-conf dust deposit hijack the "latest sender"
// refund destination. Both flow through senderLookup, so it's tested
// here directly rather than through each refund processor.

const WALLET_ADDR = 'Swallet_lookup_1234567890abcdefgh';
const CONFIRMED_SENDER = 'Sconfirmed_sender_1234567890abcdef';
const UNCONFIRMED_SENDER = 'Sunconfirmed_sender_1234567890abcd';

type MockRpc = ReturnType<typeof createMockRpc>;

interface WireTx {
  txid: string;
  sender: string;
  amount: number;
  time: number;
  confirmations: number;
}

// Wire listTransactions (the fallback path — no incoming_txs rows) plus
// the per-txid input decode and per-txid confirmation depth.
function wire(mockRpc: MockRpc, txs: WireTx[]): void {
  mockRpc.listTransactions.mockResolvedValue(
    txs.map((t) => ({
      category: 'receive',
      address: WALLET_ADDR,
      txid: t.txid,
      amount: t.amount,
      time: t.time,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any,
  );
  const inputTxidFor = (txid: string) => `input_${txid}`;
  mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
    const match = txs.find((t) => t.txid === txid);
    if (match) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { vin: [{ txid: inputTxidFor(txid), vout: 0 }], vout: [] } as any;
    }
    const sourced = txs.find((t) => inputTxidFor(t.txid) === txid);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { vin: [], vout: [{ scriptPubKey: { addresses: [sourced?.sender] } }] } as any;
  });
  mockRpc.getTransaction.mockImplementation(async (txid: string) => {
    const match = txs.find((t) => t.txid === txid);
    return { confirmations: match ? match.confirmations : 0 } as never;
  });
}

const MIN = config.MIN_CONFIRMATIONS;

describe('senderLookup confirmation discipline', () => {
  let mockRpc: MockRpc;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
    mockRpc = createMockRpc();
  });

  it('excludes a sender whose only deposit is below MIN_CONFIRMATIONS', async () => {
    wire(mockRpc, [
      { txid: 'unconf', sender: UNCONFIRMED_SENDER, amount: 100, time: 1000, confirmations: 0 },
    ]);

    const senders = await findAllSenders(mockRpc as never, WALLET_ADDR, MIN);

    expect(senders).toEqual([]);
  });

  it('counts only the confirmed portion of a sender with mixed deposits (H1 drain guard)', async () => {
    // Attack shape: a small confirmed deposit opens the refund path, a
    // large 0-conf deposit rides along. Only the confirmed 5 GRC may be
    // attributed — never the 100 GRC that can still be double-spent.
    wire(mockRpc, [
      { txid: 'small_conf', sender: CONFIRMED_SENDER, amount: 5, time: 1000, confirmations: MIN },
      { txid: 'big_unconf', sender: CONFIRMED_SENDER, amount: 100, time: 2000, confirmations: 0 },
    ]);

    const senders = await findAllSenders(mockRpc as never, WALLET_ADDR, MIN);

    expect(senders).toHaveLength(1);
    expect(senders[0].address).toBe(CONFIRMED_SENDER);
    expect(senders[0].amountHalford).toBe(BigInt(5) * BigInt(config.HALFORD));
  });

  it('does not let a later 0-conf dust deposit hijack the refund destination (H2)', async () => {
    // The real payer confirmed first; an attacker then broadcasts a
    // later dust tx to become "latest sender". With 0-conf excluded,
    // the confirmed payer remains the destination.
    wire(mockRpc, [
      { txid: 'real', sender: CONFIRMED_SENDER, amount: 10, time: 1000, confirmations: MIN },
      { txid: 'dust', sender: UNCONFIRMED_SENDER, amount: 0.01, time: 5000, confirmations: 0 },
    ]);

    const target = await findSenderAddress(mockRpc as never, WALLET_ADDR, MIN);

    expect(target).toBe(CONFIRMED_SENDER);
  });

  it('returns empty when every deposit is unconfirmed', async () => {
    wire(mockRpc, [
      { txid: 'a', sender: CONFIRMED_SENDER, amount: 10, time: 1000, confirmations: MIN - 1 },
      { txid: 'b', sender: UNCONFIRMED_SENDER, amount: 20, time: 2000, confirmations: 0 },
    ]);

    expect(await findAllSenders(mockRpc as never, WALLET_ADDR, MIN)).toEqual([]);
    expect(await findSenderAddress(mockRpc as never, WALLET_ADDR, MIN)).toBeNull();
  });

  it('fails closed: a confirmation-check RPC error excludes the tx', async () => {
    wire(mockRpc, [
      { txid: 'ok', sender: CONFIRMED_SENDER, amount: 10, time: 1000, confirmations: MIN },
    ]);
    mockRpc.getTransaction.mockRejectedValue(new Error('daemon down'));

    expect(await findAllSenders(mockRpc as never, WALLET_ADDR, MIN)).toEqual([]);
  });
});
