import { config } from './config';
import { connect } from './lib/gridcoin';
import { log } from './lib/log';
import { WalletsService } from './services/wallet/walletsService';
import { WalletsBalanceUpdaterService } from './services/wallet/walletsBalanceUpdater';
import { DbLogService } from './services/dbLog/dbLogService';
import './api';
import { WalletExpiredProcessorService } from './services/wallet/walletExpiredProcessorService';

async function initConnections(): Promise<void> {
  while (!await connect()) {
    log.info('Connecting to the gridcoin wallet...');
  }
  log.info('Connected to the gridcoin wallet...');
}

function toMs(sec: number): number {
  return sec * 1000;
}

async function main(): Promise<void> {
  await initConnections();
  // const stampService = new StampService();
  // const scraper = new Scraper();
  // // run scraper once per minute
  // setInterval(() => scraper.scrape(), config.SCRAPER_TIMEOUT);
  // setInterval(() => stampService.publishStamp(), config.PUBLISH_TIMEOUT);

  // Register log service
  DbLogService.registerEventListener();

  setInterval(
    // At first, update balances
    () => WalletsBalanceUpdaterService.updateBalances()
      // Mark funded wallets
      .then(() => WalletsService.findFundedWallets())
      // Mark expired wallets
      .then(() => WalletsService.expireWallets())
      // Process funded wallets (send change back, send to recipient)
      // Process expired wallets (send amount back if any)
      .then(() => WalletExpiredProcessorService.processExpired())
      .then(() => console.log('-------------------------')),
    toMs(config.JOBS_INTERVAL),
  );
  // setInterval(
  //   () => WalletsBalanceUpdaterService.updateBalances(),
  //   toMs(config.EXPIRED_JOB_INTERVAL + 3),
  // );
  // setInterval(
  //   () => WalletsService.findFundedWallets(),
  //   toMs(config.EXPIRED_JOB_INTERVAL + 6),
  // );
}

main();
