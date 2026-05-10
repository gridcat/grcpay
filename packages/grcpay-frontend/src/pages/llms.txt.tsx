import type { GetServerSideProps } from 'next';
import { IS_TESTNET } from '@/lib/network';
import { SITE_URL } from '@/components/Seo';

// /llms.txt — plain-text summary for LLMs / AEO per https://llmstxt.org/.
// Mainnet only: testnet is noindex/nofollow, so an llms.txt on testnet
// would be wasted bytes. The route returns 404 there. All canonical
// URLs come from NEXT_PUBLIC_SITE_URL via SITE_URL.

const content = `# Gridcoin Pay

> Self-hosted Gridcoin payment facilitator. Mints a fresh Gridcoin address for every order, watches the blockchain for incoming funds, and forwards the payment to the merchant. Non-custodial, open source.

GRCpay is a small backend service merchants run alongside their checkout. For each order, the API mints a one-shot Gridcoin address, watches the chain for the expected amount, and forwards the funds to the merchant's wallet once received. If a wallet expires unpaid (or with the wrong amount), GRCpay walks the transaction history and refunds the sender automatically. There is no custody and no middleman: funds flow directly from buyer to merchant on the Gridcoin blockchain.

## Documentation
- [About](${SITE_URL}/about): How GRCpay works — protocol, wallet lifecycle (\`new → funded → processed\`), refund and expiry behavior
- [API Reference](${SITE_URL}/developers): Public REST API — create payment wallets, look up status, fetch QR codes, convert fiat amounts via the rates endpoint
- [Self-hosting](${SITE_URL}/self-hosting): Run GRCpay on your own infrastructure — Docker Compose stack, configuration reference, reverse-proxy snippets, day-to-day operations
- [Integrations](${SITE_URL}/integrations): Ecommerce plugins that wrap the GRCpay API — WooCommerce in beta testing, others on the roadmap

## Optional
- [Live demo](${SITE_URL}/demo): Mint a real payment wallet against the public GRCpay backend and watch its lifecycle in real time
- [Disclaimer](${SITE_URL}/disclaimer): Legal small-print for using GRCpay and the public \`grcpay.gridcoin.club\` instance
- [Service status](${SITE_URL}/api/status): Current service version and maintenance flag
- [Rates endpoint (live JSON:API)](${SITE_URL}/api/rates): Supported fiat currencies and current GRC quote (CoinGecko, 5-minute cache)
`;

export default function LlmsTxt() { return null; }

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  if (IS_TESTNET) return { notFound: true };

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.write(content);
  res.end();

  return { props: {} };
};
