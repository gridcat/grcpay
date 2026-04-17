# grcpay-frontend

Public docs + interactive demo for [grcpay.gridcoin.club](https://grcpay.gridcoin.club).

## What's here

- **Landing page** — pitch and feature tiles
- **`/about`** — protocol explainer (lifecycle, settlement, refunds, expiry, privacy)
- **`/developers`** — REST API reference for [grcpay](../grcpay)
- **`/demo`** — interactive "create a payment wallet" flow that hits the running backend
- **`/integrations`** — ecommerce plugin index (WooCommerce live, others coming soon)
- **`/integrations/woocommerce`** — install / configure / try-it-live walkthrough

## Local dev

```bash
npm install
cp .env.example .env       # edit if your backend isn't on http://localhost:7001
npm run dev                # listens on http://localhost:3001
```

The backend ([`packages/grcpay`](../grcpay)) needs to be running for the demo and developer pages to fetch real data.

## Env vars

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Browser-visible backend base URL (e.g. `/api` in prod, `http://localhost:7001` in dev) |
| `NEXT_PUBLIC_API_URL_SERVER` | Backend URL used during SSR — can resolve over the Docker network |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for SEO and Open Graph metadata |
| `NEXT_PUBLIC_TRACK` | `true` to load the Plausible analytics script |
| `NEXT_PUBLIC_EXPLORER_URL` | Gridcoin block explorer base URL for linking addresses |

## Stack

Next.js 16, React 19, MUI 9, Emotion, axios, yayson, Vitest. Nx is wired up via [`project.json`](./project.json) for cross-package targets.
