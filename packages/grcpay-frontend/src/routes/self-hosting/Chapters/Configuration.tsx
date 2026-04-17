import {
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
} from '@mui/material';
import React from 'react';

interface EnvVar {
  name: string;
  required: boolean;
  default?: string;
  description: string;
}

const envVars: EnvVar[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    default: 'file:../data/payment.db',
    description:
      "SQLite file location. The path is resolved relative to prisma/schema.prisma inside the container, so '../data' lands in /usr/src/app/data — which is where the data volume should be mounted.",
  },
  {
    name: 'PORT',
    required: true,
    default: '7001',
    description: 'HTTP port GRCpay listens on.',
  },
  {
    name: 'GRC_RPC_HOST',
    required: true,
    description:
      'Hostname or IP of the gridcoinresearchd RPC interface. In a Compose setup, this is the wallet service name (e.g. "wallet"). For an existing wallet on the same host, use host.docker.internal.',
  },
  {
    name: 'GRC_RPC_PORT',
    required: true,
    default: '32748',
    description: 'RPC port. 32748 = mainnet, 32746 = testnet.',
  },
  {
    name: 'GRC_RPC_USER',
    required: false,
    description:
      "RPC username. Must match rpcuser in the wallet's gridcoinresearch.conf. Optional but strongly recommended — GRCpay will start without it for dev convenience, but the wallet will refuse RPC calls without matching credentials.",
  },
  {
    name: 'GRC_RPC_PASSWORD',
    required: false,
    description:
      'RPC password. Same constraints as GRC_RPC_USER above.',
  },
  {
    name: 'LIFE_SPAN',
    required: false,
    default: '7200',
    description:
      'How long a payment wallet stays open before it gets marked expired, in seconds. Default is 2 hours.',
  },
  {
    name: 'JOBS_INTERVAL',
    required: false,
    default: '10',
    description:
      'How often the background job loop runs (balance updates → funded detection → expiry → forwarding → refunds), in seconds. A tick is skipped if the previous run is still in flight, so long RPC batches can never overlap onto themselves.',
  },
  {
    name: 'LATE_PAYMENT_WINDOW',
    required: false,
    default: '604800',
    description:
      'How long after a wallet reaches a terminal state (processed / refunded / norefund) GRCpay still watches it for late-arriving customer payments, in seconds. Inside the window, any GRC that trickles in from a stale checkout page or a saved address is detected and refunded to the sender automatically. Outside it, funds sent to a stale address stay in the hot wallet for manual sweep. Default 7 days — past which every reasonable browser cache or checkout session is assumed gone.',
  },
  {
    name: 'LATE_PAYMENT_CHECK_INTERVAL',
    required: false,
    default: '3600',
    description:
      'How often the late-payment sweep runs, in seconds. Deliberately separate from (and much slower than) JOBS_INTERVAL because late payments are an edge-case rescue path, not a latency-sensitive flow. Default once an hour. Set to 0 to disable the sweep entirely — useful if you don\'t want GRCpay auto-touching terminal wallets at all and prefer to sweep the hot wallet manually.',
  },
  {
    name: 'MAX_REFUND_ATTEMPTS',
    required: false,
    default: '5',
    description:
      'How many times a refund RPC call is allowed to fail before GRCpay gives up. Applies to both overpayment refunds (funded processor) and late-payment refunds. Past the cap the funded processor falls back to forwarding the full received balance so the merchant payout is never blocked indefinitely; the late-payment processor leaves the funds in the hot wallet and stops retrying.',
  },
  {
    name: 'REFUND_RETRY_BASE_DELAY',
    required: false,
    default: '30',
    description:
      'Exponential backoff base for refund retries, in seconds. After failure N the next attempt is gated by base * 2^(N-1) — so with the default 30s the intervals are 30s, 1m, 2m, 4m, spanning ~7.5 minutes before MAX_REFUND_ATTEMPTS trips. The window exists so a real human operator has time to unlock a locked wallet (the usual root cause of a refund RPC failure) before GRCpay declares the refund hopeless.',
  },
  {
    name: 'MIN_CONFIRMATIONS',
    required: false,
    default: '2',
    description:
      'Minimum number of block confirmations a received tx must have before it counts toward a wallet\'s settled balance. The balance updater queries the daemon at both MIN_CONFIRMATIONS and 0-conf on every tick — the confirmed portion lands in amountRecieved and gates the new → funded flip, while the unconfirmed delta is reported separately as amountPending so integrators can surface a "waiting for N confirmations" state. Default 2 matches standard e-commerce hardening against same-block reorgs. Lower to 1 on private or trusted chains; set to 0 to accept 0-conf payments (faster but unsafe against reorgs).',
  },
  {
    name: 'RATE_LIMIT_WALLET_CREATE_PER_MIN',
    required: false,
    default: '10',
    description:
      'Per-IP rate limit on POST /wallets, in requests per minute. Keeps wallet creation cheap to abuse-proof: each call mints a fresh gridcoin address and burns an RPC slot, so the default is deliberately tight. Legitimate merchant checkout flows rarely exceed a handful per minute per IP, so raise it only if you have a specific reason.',
  },
  {
    name: 'RATE_LIMIT_WALLET_READ_PER_MIN',
    required: false,
    default: '300',
    description:
      'Per-IP rate limit on GET /wallets/:address, in requests per minute. Needs to be generous because the WooCommerce plugin polls every 5 seconds per open checkout page (12 req/min per tab), and multiple concurrent customers behind the same NAT share one bucket. Default 300 covers roughly 25 concurrent customers on a shared IP with headroom.',
  },
  {
    name: 'RATE_LIMIT_WALLET_DELETE_PER_MIN',
    required: false,
    default: '10',
    description:
      'Per-IP rate limit on DELETE /wallets/:address (merchant-initiated cancellation), in requests per minute. Same envelope as creation — rarely used in normal operation, tight by default to blunt abuse.',
  },
  {
    name: 'RATE_LIMIT_QR_PER_MIN',
    required: false,
    default: '120',
    description:
      'Per-IP rate limit on GET /wallets/:address/qr, in requests per minute. This endpoint is intentionally public (for <img> embedding on checkout pages), so it has its own bucket separate from the token-gated read endpoint. The QR renderer is cheap but not free; 120/min/IP is comfortable for real use without leaving an amplification target wide open.',
  },
  {
    name: 'RATE_LIMIT_RATES_PER_MIN',
    required: false,
    default: '60',
    description:
      'Per-IP rate limit on GET /rates and /rates/:currency, in requests per minute. Server-side cached for five minutes, so requests beyond the cache TTL hit CoinGecko rather than GRCpay; the limiter mostly exists to discourage polling storms.',
  },
  {
    name: 'RPC_BREAKER_THRESHOLD',
    required: false,
    default: '5',
    description:
      'Circuit breaker failure threshold for the Gridcoin RPC client. After this many consecutive failures (timeouts or errors), the breaker opens and fast-fails every subsequent RPC call without touching the wallet daemon for RPC_BREAKER_COOLDOWN_MS. One probe call goes through after the cooldown; success closes the breaker, failure reopens it with a fresh cooldown. Set to 0 to disable the breaker entirely — useful for dev or when troubleshooting an unrelated issue. The per-call 30s timeout still applies regardless.',
  },
  {
    name: 'RPC_BREAKER_COOLDOWN_MS',
    required: false,
    default: '30000',
    description:
      'How long (in milliseconds) the RPC breaker stays open before it lets a probe call through. Matches the per-call RPC timeout budget by default: five failed 30s calls already cost the job loop 2.5 minutes, so the breaker blocks further requests for at least one more cycle before we retry. Raise this if your wallet daemon takes longer to recover from the kind of failure you\'re seeing; lower it only in dev.',
  },
  {
    name: 'TRUST_PROXY_HOPS',
    required: false,
    default: '1',
    description:
      'Number of reverse-proxy hops Express should trust when reading the client IP from X-Forwarded-For. The per-IP rate limiters read req.ip, so getting this wrong either (a) trusts forged X-Forwarded-For values when GRCpay is directly exposed, letting an attacker rotate fake IPs to bypass the limit, or (b) buckets every request under nginx\'s loopback address when deployed behind a real proxy. Default 1 assumes a single trusted upstream (the usual nginx-in-front deployment). Set to 0 if GRCpay is directly exposed on a public port with no reverse proxy. Set to 2+ if there are multiple proxies (e.g., Cloudflare → nginx → GRCpay).',
  },
  {
    name: 'NODE_ENV',
    required: false,
    default: '(unset)',
    description:
      'Set to "production" in deployed environments. Quiets the verbose per-request HTTP access log and disables a few dev-only behaviours.',
  },
];

function Required({ value }: { value: boolean }) {
  if (value) return <Chip label="Required" color="primary" size="small" sx={{ fontWeight: 700 }} />;
  return <Chip label="Optional" size="small" />;
}

export function Configuration() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="configuration" sx={{ pb: 2 }}>
        Configuration reference
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Every GRCpay setting can be passed as an environment variable.
          Defaults come from
          {' '}
          <code>config.json</code>
          {' '}
          and
          {' '}
          <code>src/config.ts</code>
          {' '}
          inside the container; env vars override anything in those
          files.
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ my: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Variable</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Default</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {envVars.map((v) => (
                <TableRow key={v.name}>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, verticalAlign: 'top' }}>
                    {v.name}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}><Required value={v.required} /></TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', verticalAlign: 'top', color: 'text.secondary' }}>
                    {v.default ?? '—'}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', verticalAlign: 'top' }}>
                    {v.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}
