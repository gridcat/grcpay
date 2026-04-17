import nconf from 'nconf';
import path from 'path';
import packageJson from '../package.json';

interface Config {
  DATABASE_URL: string;
  GRC_RPC_USER?: string;
  GRC_RPC_PASSWORD?: string;
  GRC_RPC_HOST: string;
  GRC_RPC_PORT: number;
  isProduction: boolean;
  isTesting: boolean;
  PORT: number;
  LIFE_SPAN: number;
  JOBS_INTERVAL: number;
  HALFORD: number;
  MIN_FEE: number;
  LATE_PAYMENT_WINDOW: number;
  LATE_PAYMENT_CHECK_INTERVAL: number;
  MAX_REFUND_ATTEMPTS: number;
  REFUND_RETRY_BASE_DELAY: number;
  // Minimum number of block confirmations required before a customer's
  // payment counts toward the wallet's settled balance. The balance
  // updater calls getReceivedByAddress(address, MIN_CONFIRMATIONS) and
  // stores the result in amount_recieved — anything with fewer
  // confirmations is reported separately as amount_pending so the
  // integrator can surface a "waiting for N confirmations" state to
  // the user. Default 2, which matches the standard crypto e-commerce
  // hardening against same-block reorgs.
  MIN_CONFIRMATIONS: number;
  // Per-IP sliding-window rate limits, keyed by endpoint class.
  // Window is always 60 seconds. Tighter on write endpoints (create /
  // cancel) because those touch the wallet daemon and cost real RPC
  // time; looser on read endpoints (poll status / QR) because the
  // WooCommerce plugin polls GET /wallets/:id every 5 seconds per
  // open checkout — 12 req/min/tab just for the happy path, before
  // you count QR refreshes or multiple concurrent customers.
  RATE_LIMIT_WALLET_CREATE_PER_MIN: number;
  RATE_LIMIT_WALLET_READ_PER_MIN: number;
  RATE_LIMIT_WALLET_DELETE_PER_MIN: number;
  RATE_LIMIT_QR_PER_MIN: number;
  RATE_LIMIT_RATES_PER_MIN: number;
  // Circuit breaker for the Gridcoin RPC client. Wraps the existing
  // per-call timeout: after RPC_BREAKER_THRESHOLD consecutive failures
  // the breaker opens and fast-fails every subsequent call for
  // RPC_BREAKER_COOLDOWN_MS without touching the daemon, giving it
  // room to recover. Set threshold to 0 to disable entirely.
  RPC_BREAKER_THRESHOLD: number;
  RPC_BREAKER_COOLDOWN_MS: number;
  // Number of reverse-proxy hops Express should trust when reading
  // the client IP from X-Forwarded-For. Per-IP rate limits depend on
  // this — a wrong value either (a) trusts forged headers when grcpay
  // is directly exposed, letting an attacker rotate fake IPs to bypass
  // the limiter, or (b) buckets every request under nginx's loopback
  // address when deployed behind a real proxy. Default 1 assumes one
  // trusted upstream (the usual nginx-in-front deployment). Set to 0
  // if grcpay is directly exposed on a public port with no proxy.
  TRUST_PROXY_HOPS: number;
}

/**
 * Check setting existance and throw error if not provided
 * @param {Array} settings Setting name to check
 */
const checkConfig = (settings: string[]): void => {
  settings.forEach((setting: string): void => {
    if (!nconf.get(setting)) {
      throw new Error(`You must set ${setting} as an environment variable or in config.json!`);
    }
  });
};

nconf
  // 1. Command-line arguments
  .argv()
  // 2. Environment variables
  .env({
    whitelist: [
      'DATABASE_URL',
      'CHECK_INTERVAL_SECONDS',
      'GRC_RPC_USER',
      'GRC_RPC_PASSWORD',
      'GRC_RPC_HOST',
      'GRC_RPC_PORT',
      'PORT',
      'LATE_PAYMENT_WINDOW',
      'LATE_PAYMENT_CHECK_INTERVAL',
      'MAX_REFUND_ATTEMPTS',
      'REFUND_RETRY_BASE_DELAY',
      'MIN_CONFIRMATIONS',
      'RATE_LIMIT_WALLET_CREATE_PER_MIN',
      'RATE_LIMIT_WALLET_READ_PER_MIN',
      'RATE_LIMIT_WALLET_DELETE_PER_MIN',
      'RATE_LIMIT_QR_PER_MIN',
      'RATE_LIMIT_RATES_PER_MIN',
      'RPC_BREAKER_THRESHOLD',
      'RPC_BREAKER_COOLDOWN_MS',
      'TRUST_PROXY_HOPS',
    ],
    // nconf stores env values as strings. Parse the numeric settings
    // so downstream code can do arithmetic on them without Number(...)
    // guards everywhere.
    parseValues: true,
  })
  // 3. Config file
  .file({
    file: path.join(__dirname, '../config.json'),
  })
  // 4. Defaults
  .defaults({
    isTesting: process.env.NODE_ENV === 'testing',
    isProduction: process.env.NODE_ENV === 'production',
    PORT: packageJson.port,
    LIFE_SPAN: 1 * 60 * 60 * 2, // 2 hours
    JOBS_INTERVAL: 1 * 10,
    HALFORD: 100000000,
    MIN_FEE: 0.001,
    // How long after a wallet reaches a terminal state we still watch
    // it for late-arriving customer payments. Past this window we
    // assume any stale checkout page that might have still had the
    // address cached is long gone, so funds sent later are either an
    // operator problem or somebody doing something weird — either
    // way, not worth polling for. 7 days is the default cache/session
    // horizon for most e-commerce frontends.
    LATE_PAYMENT_WINDOW: 60 * 60 * 24 * 7, // 7 days
    // How often the late-payment processor sweeps terminal wallets
    // inside the window. This is an edge-case rescue path, not a
    // latency-sensitive flow, so it runs on its own slow timer rather
    // than on every main-loop tick. Default 1 hour: good enough to
    // refund a confused customer on the same shopping session, cheap
    // enough to be fine even with thousands of historical wallets.
    // Operators who don't want this sweep at all can set
    // LATE_PAYMENT_CHECK_INTERVAL=0 in the env — index.ts treats 0
    // as "disabled" and skips scheduling the timer entirely.
    LATE_PAYMENT_CHECK_INTERVAL: 60 * 60, // 1 hour
    // How many times a refund RPC call is allowed to fail before the
    // funded processor gives up and falls back to forwarding the full
    // received balance to the merchant.
    MAX_REFUND_ATTEMPTS: 5,
    // Exponential backoff base for refund retries, in seconds. After
    // failure N the next attempt is gated by
    // REFUND_RETRY_BASE_DELAY * 2^(N-1) seconds since the last update
    // — so with the default 30s the intervals are 30s, 1m, 2m, 4m,
    // spanning ~7.5 minutes before the MAX_REFUND_ATTEMPTS cap kicks
    // in. That window exists so a real human operator has time to
    // actually unlock the wallet (the usual cause of a locked-wallet
    // refund failure) before grcpay gives up.
    REFUND_RETRY_BASE_DELAY: 30,
    // Minimum block confirmations required before a tx counts as
    // settled. 2 is a sane default for e-commerce-grade hardening
    // against same-block reorgs; operators running on a trusted or
    // private testnet can set MIN_CONFIRMATIONS=0 in the env to
    // accept 0-conf txs if they'd rather trade safety for latency.
    MIN_CONFIRMATIONS: 2,
    // Write endpoints — tight. POST /wallets mints a fresh gridcoin
    // address (RPC call + key derivation); 10/min/IP is plenty for
    // one merchant's checkout flow and short of any abuse budget.
    RATE_LIMIT_WALLET_CREATE_PER_MIN: 10,
    // Read endpoint — generous. The WooCommerce plugin polls
    // GET /wallets/:id every 5 seconds per open thank-you page,
    // so a single customer burns 12 req/min before anyone else
    // shows up. 300 covers ~25 concurrent customers sharing one
    // NAT/proxy IP with comfortable headroom.
    RATE_LIMIT_WALLET_READ_PER_MIN: 300,
    RATE_LIMIT_WALLET_DELETE_PER_MIN: 10,
    // QR endpoint — intentionally public for <img> embedding. Cap
    // is higher than create/delete but still bounded: the QR is
    // ~3KB of base64 PNG per request and the renderer is cheap.
    RATE_LIMIT_QR_PER_MIN: 120,
    RATE_LIMIT_RATES_PER_MIN: 60,
    // Circuit breaker defaults. Five consecutive RPC failures
    // (timeouts or errors) flip the breaker open; it fast-fails
    // every subsequent call for 30 seconds before probing with
    // one tentative request. Matches the RPC timeout budget —
    // five failed 30s calls is already 2.5 minutes of misery for
    // the job loop, any more and we're just wasting cycles on a
    // daemon that isn't coming back on its own.
    RPC_BREAKER_THRESHOLD: 5,
    RPC_BREAKER_COOLDOWN_MS: 30_000,
    TRUST_PROXY_HOPS: 1,
  });

// Check required settings.
// GRC_RPC_USER / GRC_RPC_PASSWORD are intentionally NOT required:
// the dev wallet runs without RPC auth, and prod creds are supplied
// via env files at deploy time.
checkConfig([
  'DATABASE_URL',
  'GRC_RPC_HOST',
  'GRC_RPC_PORT',
  'PORT',
]);

export const config = Object.freeze(nconf.get()) as Config;
