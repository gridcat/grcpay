import React from 'react';
import { Typography, Box } from '@mui/material';
import { Endpoint } from '@/components/Endpoint/Endpoint';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { NextMuiLink } from '@/components/NextMuiLink';
import { SITE_URL } from '@/components/Seo';

export function Webhooks() {
  return (
    <Box id="webhooks" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Webhooks
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Webhooks are opt-in, and they sit on top of polling rather
          than replace it. Polling
          {' '}
          <code>GET /wallets/:address</code>
          {' '}
          keeps working for every wallet exactly as before. If you also
          pass a
          {' '}
          <code>webhookUrl</code>
          {' '}
          when you create the wallet, GRCpay also POSTs you a signed
          notification on every meaningful status change, so your store
          hears about a payment in seconds instead of waiting for its
          own next poll on top of GRCpay&apos;s poll cadence.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The feature is off by default and self-hosted only. The
          public sandbox instance does not send webhooks; an operator
          turns them on for their own GRCpay with
          {' '}
          <code>WEBHOOKS_ENABLED=true</code>
          . Passing a
          {' '}
          <code>webhookUrl</code>
          {' '}
          to an instance with webhooks disabled returns a
          {' '}
          <code>400</code>
          , so you find out at once instead of silently never receiving
          anything.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Enabling per wallet
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Add
          {' '}
          <code>webhookUrl</code>
          {' '}
          to the attributes on
          {' '}
          <code>POST /api/wallets</code>
          . It is validated
          {' '}
          <i>syntactically only</i>
          {' '}
          at creation. GRCpay does not ping it; the reachability and
          safety check runs at delivery time.
        </Typography>
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
        "recipient": "SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i",
        "webhookUrl": "https://shop.example.com/grcpay/callback"
      }
    }
  }'`}
        />
        <CodeBlock
          caption="Response — 201 Created (webhookSecret is a one-time reveal)"
          language="json"
          code={`{
  "data": {
    "type": "wallets",
    "id": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": {
      "address": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "status": "new",
      "token": "8Xf3K2…",
      "webhookSecret": "qZ7m…long-random-base64url-string",
      …
    }
  }
}`}
        />
        <Typography gutterBottom variant="body1" component="p" sx={{ mt: 3 }}>
          <b>Capture</b>
          {' '}
          <code>webhookSecret</code>
          {' '}
          on this response.
          {' '}
          Like
          {' '}
          <code>token</code>
          , it is generated once and never echoed again. GRCpay keeps
          it only to sign your payloads. Store it next to the address in
          your order-state table; you need it to verify every delivery.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Events
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          One POST per status transition:
          {' '}
          <code>confirming</code>
          ,
          {' '}
          <code>funded</code>
          ,
          {' '}
          <code>processed</code>
          ,
          {' '}
          <code>expired</code>
          ,
          {' '}
          <code>refunded</code>
          ,
          {' '}
          <code>norefund</code>
          ,
          {' '}
          <code>error</code>
          . The initial
          {' '}
          <code>new</code>
          {' '}
          (you already have it from the create response) and reconciler
          flap-backs are intentionally not delivered. Treat status as
          latest-wins: the payload always carries the wallet&apos;s
          current amounts, so a missed intermediate event is harmless.
        </Typography>
        <Endpoint method="POST" path="(your webhookUrl)" title="Delivery GRCpay sends to you" />
        <CodeBlock
          caption="Request body"
          language="json"
          code={`{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "wallet.status",
  "walletAddress": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "oldStatus": "confirming",
  "newStatus": "funded",
  "amountRequired": "150000000",
  "amountReceived": "150000000",
  "amountPending": "0",
  "txOut": null,
  "refundTx": null,
  "refundAmount": null,
  "createdAt": "2026-05-19T10:00:37.000Z"
}`}
        />
        <CodeBlock
          caption="Request headers"
          language="text"
          code={`Content-Type:        application/json
X-Grcpay-Event-Id:   550e8400-e29b-41d4-a716-446655440000
X-Grcpay-Timestamp:  1747648837
X-Grcpay-Attempt:    1
X-Grcpay-Signature:  sha256=<hex hmac>`}
        />
        <Typography gutterBottom variant="body1" component="p" sx={{ mt: 2 }}>
          Amounts are
          {' '}
          <b>halford strings</b>
          {' '}
          (1 GRC = 100,000,000 halford), same convention as the REST
          API. Map the delivery back to your order by
          {' '}
          <code>walletAddress</code>
          , and dedupe on
          {' '}
          <code>X-Grcpay-Event-Id</code>
          : delivery is at-least-once, so the same event id can arrive
          more than once after a retry.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Verifying the signature
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The signature is
          {' '}
          <code>HMAC-SHA256(secret, &quot;&lt;timestamp&gt;.&lt;event_id&gt;.&lt;attempt&gt;.&lt;raw body&gt;&quot;)</code>
          {' '}
          hex-encoded. Compute it over the exact raw request bytes
          (do not re-serialise the JSON first) and compare in constant
          time. Event id and attempt are part of the signed string, so
          a man-in-the-middle can&apos;t replay a captured body with a
          rewritten
          {' '}
          <code>X-Grcpay-Event-Id</code>
          {' '}
          and slip past your dedup. Reject the delivery if the
          signature doesn&apos;t match, or if
          {' '}
          <code>X-Grcpay-Timestamp</code>
          {' '}
          is more than 300 seconds off your clock. The timestamp is
          signed too, so a captured body can&apos;t be replayed later
          with a fresh clock.
        </Typography>
        <CodeBlock
          caption="Verification (Node.js / Express, raw body)"
          language="javascript"
          code={`const crypto = require('crypto');

function verifyGrcpay(req, secret) {
  const ts = Number(req.get('X-Grcpay-Timestamp'));
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const eventId = req.get('X-Grcpay-Event-Id') || '';
  const attempt = Number(req.get('X-Grcpay-Attempt')) || 0;
  // Signed input is exactly "<ts>.<event_id>.<attempt>.<raw body>".
  const signedInput = ts + '.' + eventId + '.' + attempt + '.' + req.rawBody;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(signedInput)
    .digest('hex');

  const got = req.get('X-Grcpay-Signature') || '';
  return got.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Retries &amp; delivery semantics
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Any
          {' '}
          <code>2xx</code>
          {' '}
          counts as delivered. Anything else gets retried with
          exponential backoff and then dead-lettered after the
          operator&apos;s configured attempt cap: a non-2xx, a timeout,
          a dropped connection, or a redirect (GRCpay sends
          {' '}
          <code>maxRedirects: 0</code>
          , so expose a stable endpoint and don&apos;t 30x it).
          Acknowledge fast: return
          {' '}
          <code>2xx</code>
          {' '}
          and process out of band. A slow handler that runs past the
          delivery timeout counts as a failed attempt and is retried.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Endpoint requirements (self-hosting note)
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Your callback must be
          {' '}
          <code>https://</code>
          {' '}
          and resolve to a public address. GRCpay resolves the host on
          {' '}
          <i>every</i>
          {' '}
          delivery, refuses loopback, private, link-local and other
          non-public ranges, and pins the connection to the validated
          IP so a rebind can&apos;t redirect it. Operators running a
          local test integration (say, a WooCommerce container on the
          same Docker network) can relax this with
          {' '}
          <code>WEBHOOK_ALLOW_PRIVATE=true</code>
          , which also allows
          {' '}
          <code>http://</code>
          . Never set it on an internet-facing instance. The delivery
          is an outbound request to a URL you control, so host your
          receiver where you&apos;re comfortable revealing its origin,
          and keep it off the same host as anything you don&apos;t want
          correlated.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          See also the cancel-with-funds note under
          {' '}
          <NextMuiLink href="#wallets" color="primary">Wallets</NextMuiLink>
          . A merchant cancel on a paid wallet is supported and reaches
          you as a
          {' '}
          <code>refunded</code>
          {' '}
          (or, rarely,
          {' '}
          <code>error</code>
          ) webhook once the buyer&apos;s funds are returned. Reconcile
          by
          {' '}
          <code>walletAddress</code>
          {' '}
          and don&apos;t assume a cancelled wallet is closed the moment
          you cancel it.
        </Typography>
      </Box>
    </Box>
  );
}
