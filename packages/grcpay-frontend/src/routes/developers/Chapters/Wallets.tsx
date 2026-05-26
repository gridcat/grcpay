import React from 'react';
import { Typography, Box } from '@mui/material';
import { Endpoint } from '@/components/Endpoint/Endpoint';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { NextMuiLink } from '@/components/NextMuiLink';
import { SITE_URL } from '@/components/Seo';

export function Wallets() {
  return (
    <Box id="wallets" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Wallets
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Mint a new payment wallet, then look it up later by its
          address. Wallet records carry the lifecycle status, the
          requested and received amounts, the forwarding and refund
          transaction ids once settlement has happened, and (if
          supplied) the recipient address.
        </Typography>

        <Endpoint method="POST" path="/api/wallets" title="Create a payment wallet" />
        <CodeBlock
          caption="Request"
          language="bash"
          code={`curl -X POST ${SITE_URL}/api/wallets \\
  -H 'Content-Type: application/vnd.api+json' \\
  -d '{
    "data": {
      "type": "wallets",
      "attributes": {
        "amountRequired": 1.5,
        "recipient": "SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i"
      }
    }
  }'`}
        />
        <CodeBlock
          caption="Response — 201 Created"
          language="json"
          code={`{
  "data": {
    "type": "wallets",
    "id": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": {
      "address": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "recipient": "SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i",
      "amountRequired": "150000000",
      "amountRecieved": "0",
      "amountPending": "0",
      "status": "new",
      "mode": "checkout",
      "lifespanSeconds": null,
      "txOut": null,
      "refundTx": null,
      "refundAmount": null,
      "token": "8Xf3K2…long-random-base64url-string",
      "createdAt": "2026-04-13T10:00:00.000Z",
      "updatedAt": "2026-04-13T10:00:00.000Z"
    }
  }
}`}
        />

        <Typography gutterBottom variant="body1" component="p" sx={{ mt: 3 }}>
          <b>Capture the</b>
          {' '}
          <code>token</code>
          {' '}
          <b>on the creation response.</b>
          {' '}
          It&apos;s a per-wallet access token GRCpay generates at
          creation time and reveals
          {' '}
          <i>only once</i>
          . This is the only response that will ever contain it. The
          server stores a SHA256 hash, not the raw token, so if you
          lose it there&apos;s no way to recover. You&apos;ll pass it
          back in the
          {' '}
          <code>X-Wallet-Token</code>
          {' '}
          header on every subsequent
          {' '}
          <code>GET /wallets/:address</code>
          {' '}
          and
          {' '}
          <code>DELETE /wallets/:address</code>
          {' '}
          call. Your integration layer (WooCommerce plugin, backend
          store controller, etc.) should stash the token alongside the
          address in whatever order-state table it already keeps.
        </Typography>

        <Typography gutterBottom variant="body1" component="p" sx={{ mt: 3 }}>
          Note the amounts are serialised as
          {' '}
          <b>halford strings</b>
          , not GRC floats: 1 GRC = 100,000,000 halford. Use string
          arithmetic (or a BigInt in your language of choice) to dodge
          rounding surprises. Convert to GRC only at the display layer.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The
          {' '}
          <code>recipient</code>
          {' '}
          field is optional. If you omit it, GRCpay will leave the
          funds at the generated address and just mark the wallet
          {' '}
          <code>processed</code>
          {' '}
          when fully funded. Useful when you sweep balances yourself.
          Overpayment refunds still happen in that case; only the
          forward-to-recipient step is skipped.
        </Typography>

        <Endpoint method="GET" path="/api/wallets/:address" title="Look up a wallet" />
        <Typography gutterBottom variant="body1" component="p">
          Reads are token-gated. Without the
          {' '}
          <code>X-Wallet-Token</code>
          {' '}
          header you get a 401 regardless of whether the address
          exists. GRCpay deliberately doesn&apos;t leak which
          addresses are live to unauthenticated callers. Only the
          merchant who minted the wallet should be able to observe
          amounts and settlement txids.
        </Typography>
        <CodeBlock
          caption="Request"
          language="bash"
          code={`curl ${SITE_URL}/api/wallets/SXxxx... \\
  -H 'X-Wallet-Token: 8Xf3K2…long-random-base64url-string'`}
        />
        <CodeBlock
          caption="Response — 200 OK (settled wallet with overpayment refund)"
          language="json"
          code={`{
  "data": {
    "type": "wallets",
    "id": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": {
      "address": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "recipient": "SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i",
      "amountRequired": "150000000",
      "amountRecieved": "200000000",
      "amountPending": "0",
      "status": "processed",
      "mode": "checkout",
      "lifespanSeconds": null,
      "txOut": "abc123… (forward tx to merchant)",
      "refundTx": "def456… (refund tx to customer)",
      "refundAmount": "49900000",
      "createdAt": "2026-04-13T10:00:00.000Z",
      "updatedAt": "2026-04-13T10:00:37.000Z"
    }
  }
}`}
        />
        <Typography gutterBottom variant="body1" component="p">
          Notice the absence of
          {' '}
          <code>token</code>
          {' '}
          on the GET response. It was a one-time reveal on creation
          and is never echoed back. The auth layer deliberately returns
          an identical
          {' '}
          <code>401 Unauthorized</code>
          {' '}
          response for every failure mode: missing header, wrong token,
          and address not found all look the same to the caller. An
          attacker without a token can&apos;t distinguish &quot;this
          address doesn&apos;t exist&quot; from &quot;this address
          exists but I don&apos;t have its token,&quot; so the endpoint
          can&apos;t be used as a probe oracle to enumerate live
          addresses.
        </Typography>

        <Endpoint method="DELETE" path="/api/wallets/:address" title="Cancel a live wallet" />
        <Typography gutterBottom variant="body1" component="p">
          Merchant-initiated cancellation. Useful when the item sold
          out, the order was aborted upstream, the customer abandoned
          checkout, or you renegotiated the price and are re-issuing a
          fresh wallet. Same
          {' '}
          <code>X-Wallet-Token</code>
          {' '}
          header as GET (no token or wrong token both return 401). The
          wallet flips to
          {' '}
          <code>expired</code>
          . A
          {' '}
          <code>409 Conflict</code>
          {' '}
          means cancel isn&apos;t safe right now: the wallet is already
          terminal, a broadcast is mid-flight, or a refund has already
          gone on-chain. Retry after a few seconds, by which point the
          settlement has either finished or moved into the refund flow
          on its own.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Cancelling a paid wallet refunds the buyer. The refund flow
          reads the
          {' '}
          <i>live on-chain</i>
          {' '}
          balance, then pays each sender back their contribution minus
          the network fee. Transient sender-lookup misses or RPC blips
          get retried under backoff, so the refund lands once the chain
          catches up. The wallet ends
          {' '}
          <code>refunded</code>
          , or
          {' '}
          <code>norefund</code>
          {' '}
          if nothing recoverable arrived, or
          {' '}
          <code>error</code>
          {' '}
          if a partial-refund failure needs a human. Reconcile by
          address. If you mint a replacement wallet for the same order,
          keep watching the old one until it terminalizes; a cancelled
          wallet isn&apos;t &quot;closed&quot; the moment cancel
          returns. With
          {' '}
          <code>webhookUrl</code>
          {' '}
          set, you&apos;ll get the
          {' '}
          <code>expired</code>
          {' '}
          and final terminal-state deliveries.
        </Typography>
        <CodeBlock
          caption="Request"
          language="bash"
          code={`curl -X DELETE ${SITE_URL}/api/wallets/SXxxx... \\
  -H 'X-Wallet-Token: 8Xf3K2…long-random-base64url-string'`}
        />
        <CodeBlock
          caption="Response — 204 No Content"
          language="text"
          code="(empty body)"
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Confirmation gate
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          GRCpay does not settle on 0-conf. The balance updater asks the
          wallet daemon for two balances on every tick: one at the
          configured
          {' '}
          <code>MIN_CONFIRMATIONS</code>
          {' '}
          threshold (default
          {' '}
          <b>2</b>
          ) and one at 0-conf. The difference is tracked as a separate
          {' '}
          <code>amountPending</code>
          {' '}
          field on the wallet record. Only the confirmed portion counts
          toward
          {' '}
          <code>amountRequired</code>
          , so a same-block reorg can&apos;t trick GRCpay into flipping a
          wallet to
          {' '}
          <code>funded</code>
          , and therefore can&apos;t trick you into shipping goods for
          a payment that later disappears.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Use
          {' '}
          <code>amountPending</code>
          {' '}
          to show the customer a reassuring
          {' '}
          <i>&quot;we see your payment, waiting for confirmations&quot;</i>
          {' '}
          state so they don&apos;t panic-send a second tx. Operators
          running on a private or otherwise trusted chain can lower the
          threshold with
          {' '}
          <code>MIN_CONFIRMATIONS=1</code>
          {' '}
          (or even
          {' '}
          <code>0</code>
          {' '}
          to accept 0-conf) in their grcpay environment.
        </Typography>
        <CodeBlock
          caption="Response — 200 OK (partial payment, some in mempool)"
          language="json"
          code={`{
  "data": {
    "type": "wallets",
    "id": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": {
      "amountRequired": "150000000",
      "amountRecieved":  "50000000",
      "amountPending":  "60000000",
      "status": "new",
      …
    }
  }
}`}
        />
        <Typography gutterBottom variant="body1" component="p">
          When the customer sends enough (confirmed
          {' '}
          <b>plus</b>
          {' '}
          still-unconfirmed) to cover
          {' '}
          <code>amountRequired</code>
          , the wallet transitions to
          {' '}
          <code>confirming</code>
          . The settlement path does
          {' '}
          <i>not</i>
          {' '}
          fire yet. The merchant only gets paid once the confirmed
          portion alone meets the invoice. But this is the right
          moment for your checkout UI to stop asking for more money and
          switch to a reassuring &quot;payment detected, waiting for
          confirmations&quot; banner. Without this state, customers
          sitting on the thank-you page during a slow 2-block wait have
          no signal that their transaction was seen, and they
          panic-send a second payment.
        </Typography>
        <CodeBlock
          caption="Response — 200 OK (confirming, full amount seen on-chain)"
          language="json"
          code={`{
  "data": {
    "type": "wallets",
    "id": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": {
      "amountRequired": "150000000",
      "amountRecieved":       "0",
      "amountPending": "150000000",
      "status": "confirming",
      "confirmations": 1,
      "confirmationsRequired": 3,
      …
    }
  }
}`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Settlement-related fields
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              <code>amountPending</code>
              :
              {' '}
              halford sum of inbound txs the daemon has seen at 0-conf
              that haven&apos;t yet reached
              {' '}
              <code>MIN_CONFIRMATIONS</code>
              . Display-only; never factored into settlement math. Drops
              back to
              {' '}
              <code>0</code>
              {' '}
              once everything has confirmed and moved into
              {' '}
              <code>amountRecieved</code>
              . Mempool dust / dropped txs can also make it decrease.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>confirmations</code>
              :
              {' '}
              minimum confirmation depth across the deposits seen so
              far, for the same &quot;N of M confirmations&quot; banner
              the checkout UI uses to keep customers off the
              panic-second-payment path. Only present while
              {' '}
              <code>status === &quot;confirming&quot;</code>
              ; omitted in every other state so you can&apos;t
              accidentally render a stale number.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>confirmationsRequired</code>
              :
              {' '}
              the threshold the wallet needs to clear to flip from
              {' '}
              <code>confirming</code>
              {' '}
              to
              {' '}
              <code>funded</code>
              , i.e. the server&apos;s
              {' '}
              <code>MIN_CONFIRMATIONS</code>
              {' '}
              setting (3 on the public instance). Same
              {' '}
              <code>confirming</code>
              -only visibility as
              {' '}
              <code>confirmations</code>
              .
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>txOut</code>
              :
              {' '}
              Gridcoin transaction id for the merchant forward
              (wallets with a recipient) or the first per-sender refund
              tx (expired wallets without a recipient, or wallets that
              went through the expired-refund flow). Null until
              settlement happens.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>refundTx</code>
              :
              {' '}
              Gridcoin transaction id for the overpayment refund sent
              back to the customer. Null when no overpayment refund
              happened: either the payment was exact, or the
              overpayment was too small to be worth refunding, or the
              sender couldn&apos;t be determined, or the refund tx
              itself failed to broadcast. See the
              {' '}
              <NextMuiLink href="#errors" color="primary">Errors</NextMuiLink>
              {' '}
              and fee/refund math sections for the full breakdown.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>refundAmount</code>
              :
              {' '}
              the actual halford amount returned to the customer
              (excludes the refund&apos;s own network fee, which the
              customer paid). Derived from
              {' '}
              <code>refundTx</code>
              : when
              {' '}
              <code>refundTx</code>
              {' '}
              is set,
              {' '}
              <code>refundAmount</code>
              {' '}
              is the halford sum the customer actually received back.
              Null when no refund happened.
            </Typography>
          </li>
        </Box>
      </Box>
    </Box>
  );
}
