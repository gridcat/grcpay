import { Typography, Box, Alert } from '@mui/material';
import React from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function QuickStart() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="quickstart" sx={{ pb: 2 }}>
        Quick start: connect to an existing wallet
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          If you already run
          {' '}
          <code>gridcoinresearchd</code>
          {' '}
          somewhere (on the same host, on another machine in your LAN, or
          inside a container you set up earlier), this is the smallest
          possible install. One
          {' '}
          <code>docker run</code>
          {' '}
          and you&apos;re done.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
          1. Make sure your wallet accepts the connection
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Open the wallet&apos;s
          {' '}
          <code>gridcoinresearch.conf</code>
          {' '}
          and confirm it has at minimum:
        </Typography>
        <CodeBlock
          caption="gridcoinresearch.conf"
          language="ini"
          code={`server=1
daemon=1
rpcuser=YOUR_RPC_USER
rpcpassword=YOUR_LONG_RANDOM_PASSWORD
rpcport=32748
# Allow GRCpay to reach the RPC port. Tighten this to the
# specific subnet your GRCpay container runs on. Don't use
# 0.0.0.0/0 unless you really know what you're doing.
rpcallowip=172.16.0.0/12`}
        />
        <Typography gutterBottom variant="body1" component="p" sx={{ color: 'text.secondary' }}>
          Restart the daemon after editing the config. The default
          mainnet RPC port is
          {' '}
          <code>32748</code>
          ; testnet is
          {' '}
          <code>32746</code>
          .
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          2. Run GRCpay
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          One
          {' '}
          <code>docker run</code>
          , pointed at the wallet&apos;s host and port:
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`mkdir -p ./grcpay-data

docker run -d \\
  --name grcpay \\
  --restart unless-stopped \\
  -p 127.0.0.1:7001:7001 \\
  -v $(pwd)/grcpay-data:/usr/src/app/data \\
  -e DATABASE_URL=file:../data/payment.db \\
  -e PORT=7001 \\
  -e GRC_RPC_HOST=192.168.1.50 \\
  -e GRC_RPC_PORT=32748 \\
  -e GRC_RPC_USER=YOUR_RPC_USER \\
  -e GRC_RPC_PASSWORD=YOUR_LONG_RANDOM_PASSWORD \\
  -e NODE_ENV=production \\
  ghcr.io/gridcat/grcpay:latest`}
        />
        <Typography gutterBottom variant="body1" component="p">
          Replace
          {' '}
          <code>192.168.1.50</code>
          {' '}
          with the hostname or IP where your wallet listens. If the
          wallet runs on the same host as Docker, use
          {' '}
          <code>host.docker.internal</code>
          {' '}
          instead. On Linux you also need
          {' '}
          <code>--add-host=host.docker.internal:host-gateway</code>
          .
        </Typography>

        <Alert severity="info" variant="outlined" sx={{ my: 2 }}>
          The
          {' '}
          <code>-p 127.0.0.1:7001:7001</code>
          {' '}
          binding keeps GRCpay listening only on localhost. Put a reverse
          proxy in front of it before exposing it to the internet — see
          the &ldquo;Reverse proxy&rdquo; section below.
        </Alert>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          3. Confirm it&apos;s running
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`curl http://localhost:7001/status

# Expected response (200 OK):
# { "data": { "type": "status", "attributes": {
#     "name": "grcpay", "version": "1.0.0"
# } } }`}
        />
        <Typography gutterBottom variant="body1" component="p">
          Tail the container logs (
          <code>docker logs -f grcpay</code>
          ) on the first run. You should see
          {' '}
          <i>&ldquo;Connected to the gridcoin wallet&rdquo;</i>
          . If you see
          {' '}
          <i>&ldquo;Connecting to the gridcoin wallet…&rdquo;</i>
          {' '}
          repeating forever, the RPC connection is failing. Check the
          host, port, credentials, and
          {' '}
          <code>rpcallowip</code>
          .
        </Typography>
      </Box>
    </Box>
  );
}
