# grcpay

Payment wallet lifecycle API for the Gridcoin network. Creates temporary payment addresses, monitors the blockchain for incoming funds, and either forwards them to a recipient or holds them for manual withdrawal.

## How it works

The service runs two things in parallel:

1. **HTTP API** (Express on port 7001) -- accepts wallet creation requests and status queries
2. **Background job loop** (every 10 seconds) -- monitors the blockchain and processes wallet state transitions

### Wallet lifecycle

```
Consumer calls POST /wallets
  with { amountRequired, recipient? }
         |
         v
   +-----+------+
   |  status:    |   A new Gridcoin address is generated via RPC.
   |    new      |   The consumer gets the address back and shows
   |             |   it (or a QR code) to the payer.
   +-----+------+
         |
   Balance updater checks blockchain every 10s
         |
         v
   amount_recieved >= amount_required?
    /            \
  yes             no, and LIFE_SPAN (2h) elapsed
   |                \
   v                 v
+--+---+        +----+-----+
|funded|        | expired   |
+--+---+        +----+-----+
   |                 |
   |          Has balance > 0?
   |           /          \
   |         yes           no
   |          |             |
   |          v             v
   |    Try to find     +--------+
   |    sender via      |norefund|
   |    RPC and         +--------+
   |    refund
   |      |     \
   |      v      v (can't find sender)
   |  +--------+  +-----+
   |  |refunded|  |error| <-- needs manual review
   |  +--------+  +-----+
   |
   Has recipient address?
    /              \
  yes               no
   |                 |
   v                 v
 Send funds       +----------+
 to recipient     | processed|  (funds stay in wallet,
 via RPC          +----------+   consumer withdraws manually)
   |
   v
+----------+
| processed|  (tx_out stores the transaction id)
+----------+
```

### The job loop

Runs sequentially every `JOBS_INTERVAL` seconds (default: 10). Each cycle:

| Step | Service | What it does |
|------|---------|--------------|
| 1 | `WalletsBalanceUpdaterService` | For each wallet with status `new`, calls `getReceivedByAddress` via RPC and updates `amount_recieved` in the DB |
| 2 | `WalletsService.findFundedWallets` | Finds wallets where `amount_recieved >= amount_required` and marks them `funded` |
| 3 | `WalletsService.expireWallets` | Finds wallets older than `LIFE_SPAN` that are still `new` or `error` and marks them `expired` |
| 4 | `WalletFundedProcessorService` | For `funded` wallets: if a `recipient` is set, sends funds via RPC; otherwise marks `processed` |
| 5 | `WalletExpiredProcessorService` | For `expired` wallets: if balance is 0, marks `norefund`; if balance > 0, attempts to identify the sender via transaction history and refund |

## API

All responses follow [JSON:API](https://jsonapi.org/) format (`Content-Type: application/vnd.api+json`).

Rate limit: 30 requests/minute per IP on `/wallets`.

### `GET /status`

Health check. Returns service name and version.

### `POST /wallets`

Create a new payment wallet.

**Request body:**
```json
{
  "data": {
    "type": "wallets",
    "attributes": {
      "amountRequired": 10.5,
      "recipient": "SBqubTKufqwpupnZsvzC3kSv9MCLrFXEUz"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `amountRequired` | yes | Amount in GRC (must be > 0) |
| `recipient` | no | Gridcoin address (34 chars, base58) to forward funds to. If omitted, funds stay in the generated wallet |

**Response:** `201 Created` with the wallet resource including the generated `address`.

### `GET /wallets/:address`

Look up a wallet by its Gridcoin address. Returns current status, amounts, timestamps.

### `GET /wallets/:address/qr`

Returns a QR code for the wallet address. Accepts optional `filter[width]` query parameter (1-999 pixels).

### `GET /rates`

Returns the list of supported fiat currencies (from CoinGecko, cached 24 hours).

### `GET /rates/:currency`

Returns the current GRC exchange rate for a fiat currency. Cached for 5 minutes.

Rate limit: 60 requests/minute per IP.

**Example:** `GET /rates/eur`

```json
{
  "data": {
    "type": "rates",
    "id": "eur",
    "attributes": {
      "currency": "eur",
      "rate": 0.003421,
      "coin": "gridcoin-research",
      "ticker": "grc"
    }
  }
}
```

The `rate` value is the price of 1 GRC in the requested currency. To convert a fiat price to GRC: `grc_amount = fiat_price / rate`.

## Database

SQLite via [Kysely](https://kysely.dev) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). The database is a single file (`DATABASE_URL`, e.g. `./data/payment.db`; the legacy `file:./data/payment.db` form still works for backwards compat). Migrations run automatically when the service starts — there is no separate migration step. Three tables:

**`wallets`** -- the core table
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER (PK) | Auto-increment |
| `address` | TEXT | Generated Gridcoin payment address |
| `recipient` | TEXT, nullable | Where to forward funds |
| `amount_required` | INTEGER (bigint) | Required amount in Halford (1 GRC = 100,000,000 Halford) |
| `amount_recieved` | INTEGER (bigint) | Confirmed amount received in Halford |
| `amount_pending` | INTEGER (bigint) | Mempool/0-conf amount in Halford |
| `status` | TEXT | `new`, `confirming`, `funded`, `error`, `expired`, `processed`, `refunded`, `norefund` |
| `tx_out` | TEXT, nullable | Transaction ID when funds are forwarded |
| `refund_tx` | TEXT, nullable | Transaction ID when an overpayment refund went out |
| `refund_amount` | INTEGER (bigint), nullable | Total halford actually refunded |
| `mode` | TEXT | Wallet lifecycle mode (currently always `checkout`) |
| `lifespan_seconds` | INTEGER, nullable | Per-wallet lifespan override; null = use `LIFE_SPAN` env default |
| `token_hash` | TEXT | SHA256 of the per-wallet access token |
| `refund_attempts` | INTEGER | Cross-cycle retry counter |
| `created_at` | TEXT (ISO-8601) | Set by the app on insert |
| `updated_at` | TEXT (ISO-8601) | Set by the app on every write |

**`db_logs`** -- audit log, one row per state change
| Column | Type | Description |
|--------|------|-------------|
| `wallet_id` | INTEGER | References wallets.id |
| `action` | TEXT | What changed (`status`, `amount_recieved`, `tx_out`, etc.) |
| `old_status` | TEXT | Previous value |
| `new_status` | TEXT | New value |
| `created_at` | TEXT (ISO-8601) | Set by the app on insert |

**`incoming_txs`** -- per-wallet receive txid index, populated by the indexer; lets the late-payment refund path resolve senders without re-walking the daemon-wide listTransactions window. Unique on `(wallet_id, txid)`.

## Project structure

```
src/
  index.ts                       Entry point: RPC connection + job loop
  api.ts                         Express server, middleware, rate limiter
  config.ts                      nconf-based configuration (env > config.json > defaults)
  controllers/
    BaseController.ts            JSON:API query parsing (pagination, sort, filter, fields)
    WalletController.ts          POST /wallets, GET /wallets/:address
    QrController.ts              GET /wallets/:address/qr
    StatusController.ts          GET /status
    schemas/
      WalletSchema.ts            Joi validation for wallet creation
  services/
    wallet/
      walletCreatorService.ts    Generates address via RPC, creates DB record
      walletFinderService.ts     Looks up wallets by address
      walletsService.ts          Marks wallets as funded or expired
      walletsBalanceUpdater.ts   Polls blockchain for balance changes
      walletFundedProcessorService.ts   Forwards funds to recipient
      walletExpiredProcessorService.ts  Refunds expired wallets
    qr/
      qrCodeService.ts           QR code generation
    dbLog/
      dbLogService.ts            Event-driven audit logging
  models/
    Wallet.ts                    Wallet entity (maps DB snake_case to camelCase)
    Error.ts                     Error response model
    Generic.ts                   Generic model interface
  presenters/                    JSON:API serialization (yayson)
  routes/                        Express route definitions
  lib/
    gridcoin.ts                  RPC client initialization + connection retry
    db.ts                        Kysely + better-sqlite3 instance, BigInt JSON shim, now()
    database.ts                  Hand-written Database interface (table types)
    migrate.ts                   Boot-time migration runner (Kysely Migrator)
    log.ts                       Winston logger
    event.ts                     EventEmitter for audit log events
    nomination.ts                GRC <-> Halford conversion (Decimal.js for precision)
  migrations/
    20260507000000_initial.ts    Schema (wallets, db_logs, incoming_txs)
config.json                      Default config (non-secret values only)
Dockerfile                       Container image (node:22-alpine)
```

## Architecture patterns

- **Layering:** Route -> Controller -> Service -> Kysely. No repository layer — services run Kysely queries directly against the shared `db` instance.
- **Amounts:** Stored as 64-bit `INTEGER` in Halford units (1 GRC = 100,000,000 Halford). better-sqlite3's `defaultSafeIntegers(true)` returns them as native `bigint`, avoiding the float drift you'd get going through `Number`. `Decimal.js` is used at the GRC ↔ Halford boundary.
- **Audit logging:** Services emit events via `EventEmitter`. `DbLogService` listens and persists to `db_logs`. Decoupled from business logic.
- **Singleton services:** Each service class is instantiated once at module level and exported (e.g., `export const WalletsService = new WalletsServiceClass()`). Constructor injection is used only to override the RPC client in tests; DB access goes through the module-level `db` import.
- **Wallet status:** Defined as a TypeScript enum in `src/models/Wallet.ts` and stored as plain TEXT in SQLite. Validation happens at the application layer (Joi schemas).
- **Datetime columns** are TEXT ISO-8601 strings, always written by the app via `now()` so the format stays uniform and lexicographic comparisons in SQL stay correct.
- **Migrations:** plain TypeScript files under `src/migrations/`, applied automatically on service start by `lib/migrate.ts` (Kysely's `Migrator` + `FileMigrationProvider`). No separate migrate command, no extra deploy step.
- **JSON:API:** All API responses use yayson presenters. The `BaseController` parses standard JSON:API query params (pagination, sorting, filtering, sparse fieldsets).

## Configuration

Loaded via `nconf` with priority: CLI args > environment variables > `config.json` > defaults.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes | -- | SQLite file path (e.g. `./data/payment.db`) or `:memory:` for tests. The legacy `file:` prefix is accepted for backwards compatibility. |
| `GRC_RPC_USER` | yes | -- | Gridcoin wallet RPC username |
| `GRC_RPC_PASSWORD` | yes | -- | Gridcoin wallet RPC password |
| `GRC_RPC_HOST` | yes | `wallet` | Gridcoin wallet RPC host |
| `GRC_RPC_PORT` | yes | `47812` | Gridcoin wallet RPC port |
| `PORT` | yes | `7001` | HTTP server port |
| `LIFE_SPAN` | no | `7200` | Wallet expiration time in seconds (2 hours) |
| `JOBS_INTERVAL` | no | `10` | Background job loop interval in seconds |
| `HALFORD` | no | `100000000` | GRC to Halford conversion factor |
| `MIN_FEE` | no | `0.001` | Transaction fee in GRC |

**Important:** `GRC_RPC_USER` and `GRC_RPC_PASSWORD` must be set as environment variables. They are not in `config.json`.

## Development

```bash
# Install dependencies
npm install

# Start in dev mode (auto-rebuild + nodemon).
# Migrations run automatically on first boot — no separate step.
npm run dev

# Build
npm run build

# Start production (also runs migrations on boot)
npm start

# Type check
npm run typecheck

# Lint
npm run test:lint

# Run all checks
npm test
```

### Docker

```bash
# Build
docker build -t grcpay .

# Or use the infra compose
cd ../grc-infra && docker-compose up
```

## Wallet statuses reference

| Status | Meaning | What happens next |
|--------|---------|-------------------|
| `new` | Just created, waiting for payment | Balance updater polls for incoming funds |
| `funded` | Received >= required amount | Funded processor forwards to recipient or marks processed |
| `expired` | Wallet timed out (default 2h) | Expired processor refunds or marks norefund |
| `processed` | Terminal state -- funds forwarded or held | Nothing |
| `refunded` | Terminal state -- funds returned to sender | Nothing |
| `norefund` | Terminal state -- expired with zero balance | Nothing |
| `error` | Something failed (RPC error, can't find sender) | Needs manual review; check `db_logs` for details |

## RPC methods used

The service communicates with a Gridcoin wallet daemon via `gridcoin-rpc`:

| Method | Used by | Purpose |
|--------|---------|---------|
| `getWalletInfo()` | `gridcoin.ts` | Connection health check on startup |
| `getNewAddress()` | `walletCreatorService` | Generate unique payment address |
| `keyPoolRefill(100)` | `walletCreatorService` | Refill address pool if depleted |
| `getReceivedByAddress(addr)` | `walletsBalanceUpdater` | Check how much GRC an address has received |
| `setTXfee(amount)` | `walletFundedProcessorService`, `walletExpiredProcessorService` | Set transaction fee before sending |
| `sendToAddress(addr, amount)` | `walletFundedProcessorService`, `walletExpiredProcessorService` | Send GRC to recipient/refund address |
| `listTransactions('*', count, skip)` | `walletExpiredProcessorService` | Find incoming transactions to identify sender for refund |
| `getRawTransaction(txid, true)` | `walletExpiredProcessorService` | Decode transaction to extract sender address from inputs |

---

<p align="center">Made with ❤️ by @gridcat</p>
