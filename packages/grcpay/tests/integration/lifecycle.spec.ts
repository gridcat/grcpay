/**
 * End-to-end lifecycle coverage. Mirrors stamp.gridcoin.club's
 * integration style: spin up real services against a real (in-memory)
 * SQLite, mock the wallet daemon RPC, and walk a wallet through every
 * state transition the index.ts job loop strings together. The goal
 * is to catch regressions where one step's assumptions about another
 * step's output drift apart — something unit-per-service tests can
 * miss.
 */
import { createMockRpc } from '../helpers/mocks';
import { setupTestDb, truncateAll, insertWallet } from '../helpers/db';
import { db } from '../../src/lib/db';
import { WalletsBalanceUpdaterServiceClass } from '../../src/services/wallet/walletsBalanceUpdater';
import { WalletsServiceClass } from '../../src/services/wallet/walletsService';
import { WalletFundedProcessorServiceClass } from '../../src/services/wallet/walletFundedProcessorService';
import { WalletExpiredProcessorServiceClass } from '../../src/services/wallet/walletExpiredProcessorService';
import { WalletStatus } from '../../src/models/Wallet';

const WALLET_ADDR = 'Slifecycle_addr_67890abcdefghijklm';
const RECIPIENT_ADDR = 'Slifecycle_rcp_67890abcdefghijklmn';
const SENDER_ADDR = 'Slifecycle_sndr_67890abcdefghijklm';

function wireSender(rpc: ReturnType<typeof createMockRpc>) {
  rpc.listTransactions.mockResolvedValue([
    {
      category: 'receive', address: WALLET_ADDR, txid: 'tx_in', amount: 12, time: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ]);
  rpc.getRawTransaction.mockImplementation(async (txid: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (txid === 'tx_in') return { vin: [{ txid: 'src', vout: 0 }], vout: [] } as any;
    return {
      vin: [],
      vout: [{ scriptPubKey: { addresses: [SENDER_ADDR] } }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  });
}

async function readWallet(address: string) {
  return db
    .selectFrom('wallets')
    .selectAll()
    .where('address', '=', address)
    .executeTakeFirstOrThrow();
}

describe('Wallet lifecycle integration', () => {
  let mockRpc: ReturnType<typeof createMockRpc>;
  let balanceUpdater: WalletsBalanceUpdaterServiceClass;
  let walletsService: WalletsServiceClass;
  let fundedProcessor: WalletFundedProcessorServiceClass;
  let expiredProcessor: WalletExpiredProcessorServiceClass;

  beforeAll(setupTestDb);
  beforeEach(async () => {
    await truncateAll();
    mockRpc = createMockRpc();
    balanceUpdater = new WalletsBalanceUpdaterServiceClass(mockRpc as never);
    walletsService = new WalletsServiceClass();
    fundedProcessor = new WalletFundedProcessorServiceClass(mockRpc as never);
    expiredProcessor = new WalletExpiredProcessorServiceClass(mockRpc as never);
  });

  it('walks a wallet through new → confirming → funded → processed', async () => {
    await insertWallet({
      address: WALLET_ADDR,
      recipient: RECIPIENT_ADDR,
      amount_required: BigInt(1_000_000_000), // 10 GRC
      status: WalletStatus.new,
    });

    // Tick 1: customer's tx is in the mempool but not yet confirmed.
    // Confirmed call returns 0, 0-conf returns 10 GRC.
    mockRpc.getReceivedByAddress
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(10);
    await balanceUpdater.updateBalances();
    await walletsService.findFundedWallets();

    let row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.confirming);
    expect(row.amount_recieved).toBe(BigInt(0));
    expect(row.amount_pending).toBe(BigInt(1_000_000_000));

    // Tick 2: confirmations land. Both calls now return 10.
    mockRpc.getReceivedByAddress.mockReset();
    mockRpc.getReceivedByAddress.mockResolvedValue(10);
    await balanceUpdater.updateBalances();
    await walletsService.findFundedWallets();

    row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.funded);
    expect(row.amount_recieved).toBe(BigInt(1_000_000_000));
    expect(row.amount_pending).toBe(BigInt(0));

    // Tick 3: funded processor forwards to the merchant.
    mockRpc.sendToAddress.mockResolvedValue('forward_tx_hash');
    await fundedProcessor.processFunded();

    row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.processed);
    expect(row.tx_out).toBe('forward_tx_hash');
    expect(row.refund_tx).toBeNull();
    expect(mockRpc.sendToAddress).toHaveBeenCalledWith(
      RECIPIENT_ADDR,
      expect.any(Number),
      WALLET_ADDR,
    );
  });

  it('refunds an overpayment and forwards the exact required amount', async () => {
    await insertWallet({
      address: WALLET_ADDR,
      recipient: RECIPIENT_ADDR,
      amount_required: BigInt(1_000_000_000),
      // Customer sent 12 GRC for a 10 GRC invoice. amount_recieved
      // already reflects the confirmed balance from a prior tick.
      amount_recieved: BigInt(1_200_000_000),
      status: WalletStatus.funded,
    });

    wireSender(mockRpc);
    mockRpc.sendToAddress
      .mockResolvedValueOnce('refund_tx')
      .mockResolvedValueOnce('forward_tx');
    await fundedProcessor.processFunded();

    const row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.processed);
    expect(row.tx_out).toBe('forward_tx');
    expect(row.refund_tx).toBe('refund_tx');
    expect(row.refund_amount).toBe(BigInt(199_900_000));
  });

  it('expires a stale wallet and refunds any partial balance to its sender', async () => {
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    await insertWallet({
      address: WALLET_ADDR,
      amount_required: BigInt(1_000_000_000),
      amount_recieved: BigInt(500_000_000), // partial 5 GRC
      status: WalletStatus.new,
      created_at: longAgo,
      updated_at: longAgo,
    });

    // Tick 1: the expiry sweep flips status to expired.
    await walletsService.expireWallets();
    let row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.expired);

    // Tick 2: the expired processor walks the senders and refunds.
    mockRpc.listTransactions.mockResolvedValue([
      {
        category: 'receive', address: WALLET_ADDR, txid: 'tx_in', amount: 5, time: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);
    mockRpc.getRawTransaction.mockImplementation(async (txid: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (txid === 'tx_in') return { vin: [{ txid: 'src', vout: 0 }], vout: [] } as any;
      return {
        vin: [],
        vout: [{ scriptPubKey: { addresses: [SENDER_ADDR] } }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
    mockRpc.sendToAddress.mockResolvedValue('refund_tx_lifecycle');

    await expiredProcessor.processExpired();

    row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.refunded);
    expect(row.tx_out).toBe('refund_tx_lifecycle');
    expect(row.refund_amount).toBe(BigInt(499_900_000));
  });

  it('marks an empty expired wallet as norefund', async () => {
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    await insertWallet({
      address: WALLET_ADDR,
      amount_recieved: BigInt(0),
      status: WalletStatus.new,
      created_at: longAgo,
      updated_at: longAgo,
    });

    await walletsService.expireWallets();
    await expiredProcessor.processExpired();

    const row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.norefund);
  });

  it('walks confirming back to new when a pending tx drops out of the mempool', async () => {
    await insertWallet({
      address: WALLET_ADDR,
      amount_required: BigInt(1_000_000_000),
      amount_recieved: BigInt(0),
      amount_pending: BigInt(1_000_000_000),
      status: WalletStatus.confirming,
    });

    // Tx fell out: both confirmed and 0-conf return 0.
    mockRpc.getReceivedByAddress.mockResolvedValue(0);
    await balanceUpdater.updateBalances();
    await walletsService.findFundedWallets();

    const row = await readWallet(WALLET_ADDR);
    expect(row.status).toBe(WalletStatus.new);
    expect(row.amount_pending).toBe(BigInt(0));
  });
});
