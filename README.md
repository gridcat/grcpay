# grcpay.gridcoin.club

**Self-hosted Gridcoin payment facilitator — backend API + docs/demo frontend.**

This Nx monorepo houses everything that runs at [grcpay.gridcoin.club](https://grcpay.gridcoin.club): a privacy-first checkout helper that mints one-shot Gridcoin addresses for each customer order, monitors the blockchain for incoming payment, and forwards funds to the merchant.

## Packages

| Package | Description |
|---|---|
| [`packages/grcpay`](packages/grcpay) | Backend REST API (Express / TypeScript / Prisma + SQLite). Exposes `POST /wallets`, `GET /wallets/:address`, `GET /wallets/:address/qr`, `GET /rates`, `GET /status`. |
| [`packages/grcpay-frontend`](packages/grcpay-frontend) | Public site at grcpay.gridcoin.club — Next.js docs, developer reference, an interactive "create wallet" demo, and an Integrations section for ecommerce plugins (WooCommerce first). |

## Local development

Requires Node 22.16.0 (see `.nvmrc`) and npm 10.9.0.

```bash
# Install root devDeps + Nx
npm install

# Backend (port 7001)
cd packages/grcpay && npm install && npm run dev

# Frontend (port 3001) — separate terminal
cd packages/grcpay-frontend && npm install && npm run dev
```

Backend can also be brought up via the shared `grc-infra` Docker Compose stack (uses `grc_wallet` for live RPC):

```bash
cd ../grc-infra && docker-compose up grcpay
```

## Workspace commands

Nx targets are wired up in each package's `project.json`. Run them across all packages from the repo root:

```bash
npm run dev:typecheck     # nx run-many --target=typecheck --all
npm run dev:test:lint     # nx run-many --target=test:lint --all
npm run dev:test:unit     # nx run-many --target=test:unit --all
npm run dev:test          # unit + lint
```

## CI / Release

CircleCI (`.circleci/config.yml`) runs lint + typecheck + unit + integration on every push, with `nx affected` gating per-package jobs. On `master`, `semantic-release-monorepo` cuts per-package versions:

- Backend tags: `grcpay-vX.Y.Z` → builds & pushes `ghcr.io/gridcat/grcpay`
- Frontend tags: `grcpay-frontend-vX.Y.Z` → builds & pushes `ghcr.io/gridcat/grcpay-frontend`

Tag-triggered workflows build the production Docker images and publish them to the GitHub container registry.

## Env files (prod)

The production Compose stack (`grc-infra/prod-gridconin-club/docker-compose.yaml`) expects two env files on the host (not committed):

- `grcpay.env` — backend secrets / RPC creds
- `grcpay-frontend.env` — `NEXT_PUBLIC_*` overrides

## License

MIT — see [`LICENSE`](LICENSE).
