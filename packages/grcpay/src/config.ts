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
  // the user.
  //
  // Critically, this threshold also gates when the funded processor
  // attempts to forward to the merchant: the wallet daemon's
  // sendtoaddress refuses to spend a UTXO that the daemon's own
  // coin-selection still treats as too shallow, returning "Insufficient
  // funds" even though our settled balance is non-zero. We need
  // MIN_CONFIRMATIONS to clear that bar comfortably, otherwise the
  // forward fails, the wallet parks in `error`, and the customer ends
  // up refunded at expiry. Default 3 — enough headroom over the
  // daemon's internal spendable-depth check to make the
  // "Insufficient funds" race disappear, without making customers
  // wait the ~9 minutes that Bitcoin's 6-conf convention would
  // imply on Gridcoin's 90s blocks.
  MIN_CONFIRMATIONS: number;
  // Cap on how many of the most-recent incoming_txs rows we sample when
  // computing the "N of M confirmations" depth for a confirming wallet.
  // Bounds RPC fan-out so dust-spam against a confirming address can't
  // multiply daemon load per integrator poll. The min depth is dominated
  // by the latest tx in practice, so this sample-most-recent is faithful.
  MAX_CONFIRMATION_SAMPLE: number;
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
  // Outbound webhooks. Strictly opt-in and additive: a wallet only
  // gets webhook delivery if the caller passed a webhookUrl at
  // POST /wallets — every wallet still supports polling exactly as
  // before. Disabled wholesale by default; the public sandbox
  // instance leaves it off (it's custodial), self-hosters opt in.
  WEBHOOKS_ENABLED: boolean;
  // Allow webhook targets that resolve to private/loopback ranges and
  // permit http:// (not just https://). Off by default. Exists so the
  // family's own WooCommerce test install, which lives on the docker
  // network behind a private IP, can receive webhooks. Never enable on
  // an internet-facing instance — it removes the SSRF egress guard.
  WEBHOOK_ALLOW_PRIVATE: boolean;
  // How often (seconds) the webhook dispatcher drains the delivery
  // queue. Independent of JOBS_INTERVAL: delivery is out-of-band so it
  // never blocks the wallet state machine.
  WEBHOOK_DISPATCH_INTERVAL: number;
  // Max delivery rows claimed per dispatcher tick. Bounds one tick's
  // work so a backlog drains over several ticks (oldest first) instead
  // of one unbounded run holding the SQLite write path.
  WEBHOOK_BATCH_SIZE: number;
  // Delivery attempts before a row is dead-lettered (status='dead').
  // With WEBHOOK_RETRY_BASE_DELAY=30 the 6 attempts span
  // 30s/1m/2m/4m/8m ≈ 16 min of retry budget.
  WEBHOOK_MAX_ATTEMPTS: number;
  // Exponential-backoff base (seconds) between delivery retries:
  // attempt N waits WEBHOOK_RETRY_BASE_DELAY * 2^(N-1). Mirrors the
  // refund backoff shape.
  WEBHOOK_RETRY_BASE_DELAY: number;
  // Per-delivery HTTP timeout (ms). A slow receiver counts as a failed
  // attempt and is retried; it can't wedge the dispatcher.
  WEBHOOK_TIMEOUT_MS: number;
  // Optional key for encrypting webhook signing secrets at rest
  // (AES-256-GCM, key = SHA-256 of this string). Opt-in: unset means
  // secrets are stored plaintext (unchanged legacy behaviour). Set it
  // to keep the secret unreadable to anything with raw access to the
  // SQLite file — notably grc-control's read-only mount. Legacy
  // plaintext rows stay readable after the key is introduced.
  WEBHOOK_SECRET_KEY?: string;
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
      'MAX_CONFIRMATION_SAMPLE',
      'RATE_LIMIT_WALLET_CREATE_PER_MIN',
      'RATE_LIMIT_WALLET_READ_PER_MIN',
      'RATE_LIMIT_WALLET_DELETE_PER_MIN',
      'RATE_LIMIT_QR_PER_MIN',
      'RATE_LIMIT_RATES_PER_MIN',
      'RPC_BREAKER_THRESHOLD',
      'RPC_BREAKER_COOLDOWN_MS',
      'TRUST_PROXY_HOPS',
      'WEBHOOKS_ENABLED',
      'WEBHOOK_ALLOW_PRIVATE',
      'WEBHOOK_DISPATCH_INTERVAL',
      'WEBHOOK_BATCH_SIZE',
      'WEBHOOK_MAX_ATTEMPTS',
      'WEBHOOK_RETRY_BASE_DELAY',
      'WEBHOOK_TIMEOUT_MS',
      'WEBHOOK_SECRET_KEY',
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
    MIN_CONFIRMATIONS: 3,
    MAX_CONFIRMATION_SAMPLE: 10,
    // Each create mints a fresh on-chain key (getNewAddress), so this
    // bucket also bounds wallet.dat / keypool growth from an
    // unauthenticated caller, not just RPC load. 120/min (2/sec
    // sustained) still covers a real integrator's burst; raise it via
    // env for a high-volume server-to-server integrator.
    RATE_LIMIT_WALLET_CREATE_PER_MIN: 120,
    RATE_LIMIT_WALLET_READ_PER_MIN: 1800,
    RATE_LIMIT_WALLET_DELETE_PER_MIN: 300,
    RATE_LIMIT_QR_PER_MIN: 1200,
    RATE_LIMIT_RATES_PER_MIN: 600,
    RPC_BREAKER_THRESHOLD: 5,
    RPC_BREAKER_COOLDOWN_MS: 30_000,
    TRUST_PROXY_HOPS: 1,
    WEBHOOKS_ENABLED: false,
    WEBHOOK_ALLOW_PRIVATE: false,
    WEBHOOK_DISPATCH_INTERVAL: 15,
    WEBHOOK_BATCH_SIZE: 50,
    WEBHOOK_MAX_ATTEMPTS: 6,
    WEBHOOK_RETRY_BASE_DELAY: 30,
    WEBHOOK_TIMEOUT_MS: 10_000,
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

// nconf's parseValues:true only applies to the .env() layer above.
// Values coming from .argv() (CLI overrides like
// `--MAX_CONFIRMATION_SAMPLE=10`) stay as strings, and a string slipping
// into `.limit(...)` or arithmetic blows up only at the call site —
// hours of debugging later. Coerce the whole numeric surface here at
// boot so downstream code can trust the types.
const NUMERIC_KEYS = [
  'GRC_RPC_PORT',
  'PORT',
  'LIFE_SPAN',
  'JOBS_INTERVAL',
  'HALFORD',
  'MIN_FEE',
  'LATE_PAYMENT_WINDOW',
  'LATE_PAYMENT_CHECK_INTERVAL',
  'MAX_REFUND_ATTEMPTS',
  'REFUND_RETRY_BASE_DELAY',
  'MIN_CONFIRMATIONS',
  'MAX_CONFIRMATION_SAMPLE',
  'RATE_LIMIT_WALLET_CREATE_PER_MIN',
  'RATE_LIMIT_WALLET_READ_PER_MIN',
  'RATE_LIMIT_WALLET_DELETE_PER_MIN',
  'RATE_LIMIT_QR_PER_MIN',
  'RATE_LIMIT_RATES_PER_MIN',
  'RPC_BREAKER_THRESHOLD',
  'RPC_BREAKER_COOLDOWN_MS',
  'TRUST_PROXY_HOPS',
  'WEBHOOK_DISPATCH_INTERVAL',
  'WEBHOOK_BATCH_SIZE',
  'WEBHOOK_MAX_ATTEMPTS',
  'WEBHOOK_RETRY_BASE_DELAY',
  'WEBHOOK_TIMEOUT_MS',
];
for (const key of NUMERIC_KEYS) {
  const raw = nconf.get(key);
  if (raw === undefined || raw === null) continue;
  if (typeof raw === 'number') continue;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${key} must be a finite number, got: ${raw}`);
  }
  nconf.set(key, n);
}

// Lower-bound validation for values whose 0/negative form silently
// breaks a downstream feature rather than failing loudly. Each entry
// is the key name and the rationale for the floor.
//   MAX_CONFIRMATION_SAMPLE: 0 → confirming-wallet GET silently omits
//     confirmations/confirmationsRequired.
//   WEBHOOK_BATCH_SIZE: 0 → dispatchDue does LIMIT 0 → no webhook
//     ever delivers, only signal is the absence of "N delivery(ies)
//     due" log lines.
//   WEBHOOK_MAX_ATTEMPTS: 0 → every first failure dead-letters
//     immediately, no retry budget.
//   WEBHOOK_DISPATCH_INTERVAL: 0 → schedule() tick semantics depend
//     on the helper; either pins CPU or never fires. Either way the
//     dispatcher isn't doing what its name suggests.
//   WEBHOOK_RETRY_BASE_DELAY: 0 → next_attempt_at=now on every
//     failure, the entire MAX_ATTEMPTS budget burns in one dispatcher
//     tick.
//   WEBHOOK_TIMEOUT_MS: a value < ~100 is effectively no-timeout
//     since a fresh TCP connection rarely completes faster; 1 is the
//     defensible floor — operators wanting "unlimited" should keep
//     the default (10s) rather than zero.
// Most webhook numerics floor at 1 — 0/negative silently breaks
// delivery. WEBHOOK_TIMEOUT_MS gets a higher floor (100ms) because
// anything below the TCP handshake floor effectively turns every
// delivery into an ECONNABORTED before bytes leave the host, which
// reads as "always-timeout" not the "no-timeout" semantics the >=1
// guard might suggest.
const MIN_BOUNDS: Record<string, number> = {
  MAX_CONFIRMATION_SAMPLE: 1,
  WEBHOOK_BATCH_SIZE: 1,
  WEBHOOK_MAX_ATTEMPTS: 1,
  WEBHOOK_DISPATCH_INTERVAL: 1,
  WEBHOOK_RETRY_BASE_DELAY: 1,
  WEBHOOK_TIMEOUT_MS: 100,
};
for (const [key, floor] of Object.entries(MIN_BOUNDS)) {
  const v = nconf.get(key);
  if (typeof v !== 'number' || v < floor) {
    throw new Error(
      `${key} must be a number >= ${floor} (got: ${v}). Smaller values `
      + 'silently break a downstream feature — see config.ts.',
    );
  }
}

// MIN_CONFIRMATIONS default was bumped from 2 → 3 to clear the
// wallet daemon's spendable-depth race. Warn one-shot at boot if the
// operator didn't pin the value via env so anyone whose merchant docs
// or UI copy quote "2 of 2 confirmations" notices the change before
// customers do. Skipped under NODE_ENV=testing so the test suite
// doesn't flood stderr.
if (
  process.env.NODE_ENV !== 'testing'
  && process.env.MIN_CONFIRMATIONS === undefined
  && nconf.get('MIN_CONFIRMATIONS') === 3
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] MIN_CONFIRMATIONS=3 (default). Previous default was 2 — '
    + 'every customer payment now waits one extra block (~90s) before '
    + 'settlement. Set MIN_CONFIRMATIONS=2 via env to restore the old '
    + 'behaviour; the bump is intentional and avoids the daemon\'s '
    + '"Insufficient funds" spendable-depth race.',
  );
}

export const config = Object.freeze(nconf.get()) as Config;
