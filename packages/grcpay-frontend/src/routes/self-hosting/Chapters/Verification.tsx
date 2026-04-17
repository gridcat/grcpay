import { Typography, Box } from '@mui/material';
import React from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function Verification() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="verification" sx={{ pb: 2 }}>
        Verifying it works
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Once the container is up and GRCpay has connected to the
          wallet, run through the smoke test below. If all four steps
          pass, you&apos;re ready to wire a checkout up to it.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
          1. Status check
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`curl -s https://grcpay.example.com/api/status | jq

# Or directly against the container:
curl -s http://localhost:7001/status | jq`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          2. Mint a test payment wallet
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`RESP=$(curl -s -X POST https://grcpay.example.com/api/wallets \\
  -H 'Content-Type: application/vnd.api+json' \\
  -d '{
    "data": {
      "type": "wallets",
      "attributes": {
        "amountRequired": 0.01
      }
    }
  }')

echo "$RESP" | jq

# Capture the address and the one-time access token for step 3.
ADDR=$(echo "$RESP" | jq -r '.data.attributes.address')
TOKEN=$(echo "$RESP" | jq -r '.data.attributes.token')`}
        />
        <Typography gutterBottom variant="body1" component="p">
          You should get back a 201 with a fresh Gridcoin address in
          {' '}
          <code>data.attributes.address</code>
          . That address came from your wallet&apos;s keypool — it&apos;s
          yours, not ours. The response also contains a
          {' '}
          <code>token</code>
          {' '}
          field — GRCpay reveals the raw access token exactly once,
          right here, and only stores a SHA256 hash server-side. Stash
          it now because every subsequent read or cancel on this
          wallet will need it in the
          {' '}
          <code>X-Wallet-Token</code>
          {' '}
          header.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          3. Look it up
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`# Uses $ADDR and $TOKEN captured in step 2.
curl -s "https://grcpay.example.com/api/wallets/$ADDR" \\
  -H "X-Wallet-Token: $TOKEN" | jq

# Status should still be "new" until something arrives.
# Without the header you'd get a 401 — GRCpay deliberately
# doesn't let unauthenticated callers probe live wallets.`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          4. Send a small payment to it (optional)
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          From any other Gridcoin wallet, send 0.01 GRC to the address
          from step 2. Within ~10 seconds of the transaction confirming,
          the wallet status should flip from
          {' '}
          <code>new</code>
          {' '}
          to
          {' '}
          <code>funded</code>
          {' '}
          and then to
          {' '}
          <code>processed</code>
          . If you supplied a
          {' '}
          <code>recipient</code>
          {' '}
          field at creation time, you&apos;ll also see a forwarding
          transaction land in that wallet.
        </Typography>
      </Box>
    </Box>
  );
}
