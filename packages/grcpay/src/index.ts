import { config } from './config';
import { connect } from './lib/gridcoin';
import { log } from './lib/log';
import { migrateToLatest } from './lib/migrate';
import { WalletsService } from './services/wallet/walletsService';
import { WalletsBalanceUpdaterService } from './services/wallet/walletsBalanceUpdater';
import { DbLogService } from './services/dbLog/dbLogService';
import { startServer } from './api';
import { WalletExpiredProcessorService } from './services/wallet/walletExpiredProcessorService';
import { WalletFundedProcessorService } from './services/wallet/walletFundedProcessorService';
import { WalletLatePaymentProcessorService } from './services/wallet/walletLatePaymentProcessorService';
import { IncomingTxIndexerService } from './services/wallet/incomingTxIndexer';

async function initConnections(): Promise<void> {
  while (!await connect()) {
    log.info('Connecting to the gridcoin wallet...');
  }
  log.info('Connected to the gridcoin wallet...');
}

function toMs(sec: number): number {
  return sec * 1000;
}

/**
 * Wraps a periodic async job in a single-flight lock. If a tick fires
 * while the previous run is still in flight, it's skipped with a
 * warning — otherwise long-running RPC batches could pile up into
 * overlapping cycles and race each other on the hot wallet.
 */
function schedule(name: string, intervalSec: number, body: () => Promise<unknown>): void {
  let running = false;
  setInterval(() => {
    if (running) {
      log.warn(`${name} still in flight from the previous tick; skipping this cycle.`);
      return;
    }
    running = true;
    body()
      .catch((err) => log.error(`${name} error: ${err}`))
      .finally(() => { running = false; });
  }, toMs(intervalSec));
}

async function main(): Promise<void> {
  // Apply pending migrations before anything else touches the DB. The
  // SQLite file lives in a mounted volume, so it may be empty on first
  // boot; this is what makes `docker run` enough to spin up grcpay
  // without a separate migration step.
  await migrateToLatest();

  await initConnections();

  startServer();

  DbLogService.registerEventListener();

  schedule('Job loop', config.JOBS_INTERVAL, () => (
    // Record incoming receive txids BEFORE the balance/funded/expired
    // steps run so any refund flow they trigger downstream can resolve
    // senders from the indexed set instead of re-scanning the
    // daemon-wide listTransactions window.
    IncomingTxIndexerService.indexIncomingTxs()
      .then(() => WalletsBalanceUpdaterService.updateBalances())
      .then(() => WalletsService.findFundedWallets())
      .then(() => WalletsService.expireWallets())
      .then(() => WalletFundedProcessorService.processFunded())
      .then(() => WalletExpiredProcessorService.processExpired())
  ));

  if (config.LATE_PAYMENT_CHECK_INTERVAL > 0) {
    schedule(
      'Late-payment sweep',
      config.LATE_PAYMENT_CHECK_INTERVAL,
      () => WalletLatePaymentProcessorService.processLatePayments(),
    );
    log.info(
      `Late-payment sweep scheduled every ${config.LATE_PAYMENT_CHECK_INTERVAL}s `
      + `(window ${config.LATE_PAYMENT_WINDOW}s)`,
    );
  } else {
    log.info('Late-payment sweep disabled (LATE_PAYMENT_CHECK_INTERVAL=0)');
  }
}

main();
