import { Typography, Box, Alert } from '@mui/material';
import React from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { NextMuiLink } from '@/components/NextMuiLink';

export function FullStack() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="fullstack" sx={{ pb: 2 }}>
        Full stack: wallet + GRCpay via Docker Compose
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          If you don&apos;t already run a Gridcoin wallet, the cleanest
          option is to put both the wallet and GRCpay in the same Docker
          Compose file. They share an internal network, the wallet&apos;s
          RPC stays unreachable from outside, and you can bring the whole
          thing up or down with one command.
        </Typography>

        <Alert severity="info" variant="outlined" sx={{ my: 2 }}>
          A note on wallet images: the gridcoin-community organization
          publishes its Docker tooling at
          {' '}
          <NextMuiLink
            href="https://github.com/gridcoin-community/gridcoin-docker"
            color="primary"
          >
            gridcoin-community/gridcoin-docker
          </NextMuiLink>
          , but that&apos;s a build environment (
          <code>gridcoincommunity/grc-dev</code>
          ) for compiling the wallet from source, not a runtime daemon
          image. For a ready-to-run headless daemon, the community
          maintains
          {' '}
          <NextMuiLink
            href="https://github.com/boris1993/gridcoin-headless-docker"
            color="primary"
          >
            boris1993/gridcoin-headless-docker
          </NextMuiLink>
          {' '}
          on Docker Hub, which is what the compose file below uses. If
          you&apos;d rather build from source, swap in
          {' '}
          <code>grc-dev</code>
          {' '}
          as a build stage and copy the binary into your own runtime
          image.
        </Alert>

        <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
          Project layout
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`grcpay-server/
├── docker-compose.yaml
├── .env                 # RPC credentials, ignored by git
├── grcpay-data/         # created on first run, holds payment.db
└── wallet-data/         # created on first run, holds wallet.dat + chain`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          The compose file
        </Typography>
        <CodeBlock
          caption="docker-compose.yaml"
          language="yaml"
          code={`services:
  wallet:
    image: boris1993/gridcoin-headless-docker:latest
    container_name: grcpay-wallet
    hostname: wallet
    expose:
      - 32749
    volumes:
      # Persist the chain data + wallet.dat across restarts.
      - ./wallet-data:/root/.GridcoinResearch
    environment:
      - TZ=Etc/UTC
      # Same values must end up in grcpay below — both sides
      # read from .env so they stay in sync.
      - RPC_USER=\${GRC_RPC_USER}
      - RPC_PASSWORD=\${GRC_RPC_PASSWORD}
    restart: unless-stopped

  grcpay:
    image: ghcr.io/gridcat/grcpay:latest
    container_name: grcpay
    depends_on:
      - wallet
    ports:
      # Bind to localhost only — put a reverse proxy in front
      # of this for any outside access.
      - "127.0.0.1:7001:7001"
    volumes:
      - ./grcpay-data:/usr/src/app/data
    environment:
      - DATABASE_URL=file:../data/payment.db
      - PORT=7001
      - GRC_RPC_HOST=wallet
      - GRC_RPC_PORT=32749
      - GRC_RPC_USER=\${GRC_RPC_USER}
      - GRC_RPC_PASSWORD=\${GRC_RPC_PASSWORD}
      - NODE_ENV=production
    restart: unless-stopped`}
        />
        <Typography gutterBottom variant="body1" component="p">
          The
          {' '}
          <code>{'${GRC_RPC_USER}'}</code>
          {' '}
          and
          {' '}
          <code>{'${GRC_RPC_PASSWORD}'}</code>
          {' '}
          come from a sibling
          {' '}
          <code>.env</code>
          {' '}
          file Compose reads automatically. Both the wallet container and
          GRCpay gets the same values, so the credentials they exchange
          line up:
        </Typography>
        <CodeBlock
          caption=".env"
          language="bash"
          code={`GRC_RPC_USER=ZdMxzASxPB2ucXqJhJLcR09Gk0dHQoJt
GRC_RPC_PASSWORD=I9nFmrZIVpB5nJz797fFdxLen35jjbpr`}
        />
        <Alert severity="warning" variant="outlined" sx={{ my: 2 }}>
          Generate your own random values for these — don&apos;t reuse the
          ones in this snippet. Anything 32 characters or longer from
          {' '}
          <code>{'/dev/urandom'}</code>
          {' '}
          is fine:
          {' '}
          <code>head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32</code>
          .
        </Alert>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Bring it up
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`docker compose up -d

# Watch the wallet finish initial sync — this can take a while
# the first time, especially on mainnet.
docker compose logs -f wallet

# Once the wallet is responsive, watch grcpay connect:
docker compose logs -f grcpay`}
        />
        <Typography gutterBottom variant="body1" component="p">
          On a fresh wallet, expect the
          {' '}
          <i>&ldquo;Connecting to the gridcoin wallet…&rdquo;</i>
          {' '}
          message to repeat for a few minutes while the daemon finishes
          its startup and initial sync. As soon as the RPC port comes
          up, GRCpay logs
          {' '}
          <i>&ldquo;Connected to the gridcoin wallet&rdquo;</i>
          {' '}
          and starts its job loop.
        </Typography>
      </Box>
    </Box>
  );
}
