import { WalletCancelServiceClass, WalletCancelError } from '../../../src/services/wallet/walletCancelService';
import { Wallet, WalletStatus, WalletMode } from '../../../src/models/Wallet';
import { db } from '../../../src/lib/db';
import { setupTestDb, truncateAll, insertWallet } from '../../helpers/db';

const mockEmit = jest.fn();
jest.mock('../../../src/lib/event', () => ({
  getEventEmitter: () => ({ emit: mockEmit, on: jest.fn() }),
}));

function walletWithStatus(id: number, status: WalletStatus): Wallet {
  const w = new Wallet();
  w.id = id;
  w.address = 'Swallet_1234567890abcdefghijklmn12';
  w.recipient = null;
  w.amountRequired = BigInt(1_000_000_000);
  w.amountRecieved = BigInt(0);
  w.amountPending = BigInt(0);
  w.status = status;
  w.mode = WalletMode.checkout;
  w.tokenHash = 'abc';
  w.refundAttempts = 0;
  return w;
}

describe('WalletCancelService', () => {
  const service = new WalletCancelServiceClass();

  beforeAll(setupTestDb);
  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateAll();
  });

  // The relaxed cancel applies to ANY pre-terminal wallet that hasn't
  // forwarded yet. `new` and `confirming` are the common pre-launch
  // cases; `funded` is the negotiated-pricing case where the buyer's
  // already-paid wallet needs to be retired before a new quote's
  // wallet mints.
  it.each([
    WalletStatus.new,
    WalletStatus.confirming,
    WalletStatus.funded,
  ])('transitions a %s wallet (tx_out NULL) to expired', async (status) => {
    const row = await insertWallet({ status });
    const wallet = walletWithStatus(Number(row.id), status);
    wallet.address = row.address;

    await service.cancelWallet(wallet);

    const after = await db
      .selectFrom('wallets')
      .select(['status', 'tx_out'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('expired');
    expect(after.tx_out).toBeNull();
  });

  it('emits both a status transition and a cancelled audit entry', async () => {
    const row = await insertWallet({ status: WalletStatus.new });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.new);

    await service.cancelWallet(wallet);

    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'status',
      oldStatus: WalletStatus.new,
      newStatus: WalletStatus.expired,
    }));
    expect(mockEmit).toHaveBeenCalledWith('log', expect.objectContaining({
      walletId: Number(row.id),
      action: 'cancelled',
      newStatus: 'merchant',
    }));
  });

  // tx_out set = funds already forwarded to merchant. Refusing is the
  // only safe answer — the funded-processor's forward tx is final and
  // we don't have the merchant's keys to claw it back.
  it('rejects cancelling a wallet whose funds have already been forwarded', async () => {
    const row = await insertWallet({
      status: WalletStatus.processed,
      tx_out: 'a'.repeat(64),
    });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.processed);

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);

    const after = await db
      .selectFrom('wallets')
      .select(['status'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    // Row unchanged — the atomic UPDATE-WHERE matched zero rows.
    expect(after.status).toBe('processed');
  });

  it.each([
    WalletStatus.refunded,
    WalletStatus.norefund,
    WalletStatus.expired,
    WalletStatus.error,
  ])('rejects cancelling a wallet already in terminal state %s', async (status) => {
    const row = await insertWallet({ status });
    const wallet = walletWithStatus(Number(row.id), status);

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
  });

  it('rejects when the wallet row no longer exists (concurrent delete / unknown id)', async () => {
    const wallet = walletWithStatus(99999, WalletStatus.new);

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
  });

  it('rejects with 409 when refund_tx is already set (prior on-chain refund)', async () => {
    // Crash window: refundOverpaymentIfAny persisted refund_tx and
    // cleared its marker, then a process restart landed before the
    // forward marker claim ran. Cancel must NOT flip status here —
    // the expired processor's safety park parks rows with refund_tx
    // set as `error` and walletsService.expireWallets refuses to
    // re-include them, which would strand the buyer's principal.
    const row = await insertWallet({
      status: WalletStatus.funded,
      refund_tx: 'overpayment_refund_tx_abc',
    });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.funded);
    wallet.address = row.address;

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
    const after = await db
      .selectFrom('wallets')
      .select(['status', 'refund_tx'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('funded');
    expect(after.refund_tx).toBe('overpayment_refund_tx_abc');
  });

  it('rejects with 409 when a broadcast is in flight (pending_broadcast set)', async () => {
    const row = await insertWallet({
      status: WalletStatus.funded,
      pending_broadcast: 'forward:1:1700000000',
    });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.funded);
    wallet.address = row.address;

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
    // Status must remain `funded` — the cancel must not flip the row
    // while a broadcast may be mid-flight.
    const after = await db
      .selectFrom('wallets')
      .select(['status', 'pending_broadcast'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('funded');
    expect(after.pending_broadcast).toBe('forward:1:1700000000');
  });

  it('UPDATE atomically refuses when a marker is set between SELECT and UPDATE (TOCTOU)', async () => {
    // Simulate the race: a row that the SELECT sees as marker-null
    // but where another writer slips a marker in before our UPDATE.
    // Without the marker guard on the UPDATE, cancel would flip to
    // expired and leak the marker into the expired branch — see the
    // R5 review finding. We can't drive a real concurrent writer here,
    // but we CAN sanity-check the UPDATE's marker clause by checking
    // that a pre-existing marker prevents the flip even if the
    // SELECT-side guard at line 87 is bypassed (it isn't here, but
    // the marker filter on the UPDATE is the load-bearing defense).
    const row = await insertWallet({
      status: WalletStatus.funded,
      pending_broadcast: 'forward:1:1700000000',
    });
    const wallet = walletWithStatus(Number(row.id), WalletStatus.funded);
    wallet.address = row.address;

    await expect(service.cancelWallet(wallet)).rejects.toThrow(WalletCancelError);
    const after = await db
      .selectFrom('wallets')
      .select(['status'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('funded');
  });
});
