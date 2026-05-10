import nconf from 'nconf';
import path from 'path';
import packageJson from '../package.json';

interface Config {
  // Which Gridcoin network this instance is anchored to. Required and
  // validated against {'mainnet','testnet'} so a typo or omission fails
  // loud at startup instead of silently inheriting the wrong identity.
  // Pure label — the actual chain is selected by GRC_RPC_HOST/PORT.
  NETWORK: 'mainnet' | 'testnet';
  // SQLite database location. Either:
  //   * a filesystem path (absolute or relative to the package root)
  //   * a `file:...` URL (kept for drop-in compatibility with
  //     deployments that still ship the legacy schema.prisma value)
  //   * `:memory:` for an ephemeral in-memory DB (used by tests)
  // No default — a missing value fails loudly at startup rather
  // than silently writing to a throwaway in-memory DB.
  DATABASE_URL: string;
  // Credentials for the Gridcoin wallet daemon's JSON-RPC interface.
  // Optional because the dev wallet runs without RPC auth; production
  // containers supply both via env file at deploy time.
  GRC_RPC_USER?: string;
  GRC_RPC_PASSWORD?: string;
  // Host and port of the Gridcoin wallet daemon. In the default
  // docker-compose setup GRC_RPC_HOST is the service name "wallet"
  // and GRC_RPC_PORT is 47812 (mainnet RPC). Required — we don't
  // have a sensible fallback for where the blockchain lives.
  GRC_RPC_HOST: string;
  GRC_RPC_PORT: number;
  // Convenience mirrors of NODE_ENV. isProduction gates behaviour
  // that should only run in prod (stricter logging, real cron
  // scheduling); isTesting disables background jobs so unit tests
  // don't fire RPC calls or mutate the DB from timers.
  isProduction: boolean;
  isTesting: boolean;
  // HTTP listener port for the Express app. Defaults to
  // package.json#port (7001) so local dev matches the docker-compose
  // and nginx reverse-proxy expectations.
  PORT: number;
  // How long a payment wallet stays active before it's considered
  // expired. After this window the monitor stops watching for new
  // funds and (if a non-zero balance arrived) the refund flow
  // kicks in. 2 hours is a deliberate compromise: long enough to
  // cover a slow checkout + bank-to-exchange transfer, short enough
  // that abandoned carts stop burning RPC cycles within the same
  // browsing session.
  LIFE_SPAN: number;
  // Main job-loop tick in seconds. Every tick the funded/expired/
  // refund processors run one pass over eligible wallets. Default
  // 10s trades a few seconds of checkout latency for ~6 RPC probes
  // per minute per active wallet, which is what the daemon can
  // comfortably sustain.
  JOBS_INTERVAL: number;
  // Satoshi-equivalent denominator for Gridcoin: 1 GRC = 100_000_000
  // "halfords". RPC returns amounts in GRC (decimal); we convert
  // to integer halfords internally to avoid float drift when
  // comparing received vs required or computing refund amounts.
  HALFORD: number;
  // Minimum transaction fee (in GRC) reserved when forwarding or
  // refunding. Subtracted from the amount sent so the outgoing tx
  // is guaranteed to be accepted by the network without dipping
  // below the daemon's relay-fee floor.
  MIN_FEE: number;
  // How long (seconds) past a wallet's terminal state we keep
  // watching the address for late-arriving customer payments —
  // the "a customer paid after the checkout page timed out"
  // rescue path. Past this horizon we stop polling.
  LATE_PAYMENT_WINDOW: number;
  // How often (seconds) the late-payment sweeper runs over
  // terminal wallets inside LATE_PAYMENT_WINDOW. Separate from
  // JOBS_INTERVAL because it's an edge-case rescue, not a
  // latency-sensitive flow. Set to 0 to disable the sweep.
  LATE_PAYMENT_CHECK_INTERVAL: number;
  // Max number of refund RPC failures before the funded
  // processor gives up and forwards the received balance to
  // the merchant instead. Protects against a permanently
  // locked or unreachable wallet wedging the job loop.
  MAX_REFUND_ATTEMPTS: number;
  // Exponential-backoff base (seconds) between refund retries.
  // Attempt N is gated by REFUND_RETRY_BASE_DELAY * 2^(N-1)
  // seconds since the last update, so the default 30s yields
  // 30s / 1m / 2m / 4m — ~7.5 minutes of headroom for an operator
  // to unlock the wallet before MAX_REFUND_ATTEMPTS is reached
  // (locked wallet is the usual cause of refund failure).
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
  //
  // The limits stay deliberately generous because integrators that
  // create wallets server-to-server (a marketplace backend like
  // grcbazaar, an on-site donation widget, a crowdfunding host) all
  // appear to grcpay as a single source IP. CORS is `*` by design —
  // these per-IP buckets are the primary brake on abuse, not a tight
  // origin allowlist, so they need enough headroom for one real
  // integrator's peak hour without 429ing.
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
      'NETWORK',
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
    LATE_PAYMENT_WINDOW: 60 * 60 * 24 * 7, // 7 days
    LATE_PAYMENT_CHECK_INTERVAL: 60 * 60, // 1 hour
    MAX_REFUND_ATTEMPTS: 5,
    REFUND_RETRY_BASE_DELAY: 30,
    MIN_CONFIRMATIONS: 2,
    RATE_LIMIT_WALLET_CREATE_PER_MIN: 300,
    RATE_LIMIT_WALLET_READ_PER_MIN: 1800,
    RATE_LIMIT_WALLET_DELETE_PER_MIN: 300,
    RATE_LIMIT_QR_PER_MIN: 1200,
    RATE_LIMIT_RATES_PER_MIN: 600,
    RPC_BREAKER_THRESHOLD: 5,
    RPC_BREAKER_COOLDOWN_MS: 30_000,
    TRUST_PROXY_HOPS: 1,
  });

// Check required settings.
// GRC_RPC_USER / GRC_RPC_PASSWORD are intentionally NOT required:
// the dev wallet runs without RPC auth, and prod creds are supplied
// via env files at deploy time.
checkConfig([
  'NETWORK',
  'DATABASE_URL',
  'GRC_RPC_HOST',
  'GRC_RPC_PORT',
  'PORT',
]);

const networkValue = nconf.get('NETWORK');
if (networkValue !== 'mainnet' && networkValue !== 'testnet') {
  throw new Error(`NETWORK must be either 'mainnet' or 'testnet', got: ${networkValue}`);
}

export const config = Object.freeze(nconf.get()) as Config;
