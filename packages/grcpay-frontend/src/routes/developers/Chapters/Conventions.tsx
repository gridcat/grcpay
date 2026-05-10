import React from 'react';
import { Typography, Box } from '@mui/material';
import { NextMuiLink } from '@/components/NextMuiLink';

export function Conventions() {
  return (
    <Box id="conventions" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Conventions
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Every request and response uses the
          {' '}
          <NextMuiLink href="https://jsonapi.org/" color="primary">JSON:API</NextMuiLink>
          {' '}
          envelope. POST bodies must be sent with the content type
          {' '}
          <code>application/vnd.api+json</code>
          ; resources are wrapped in
          {' '}
          <code>{'{ "data": { "type": "...", "attributes": { ... } } }'}</code>
          .
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          CORS is wide open (
          <code>Access-Control-Allow-Origin: *</code>
          ) so the API is callable from any origin.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          <b>Rate limits</b>
          : 30 requests/min per IP on
          {' '}
          <code>/wallets</code>
          , 60 requests/min on
          {' '}
          <code>/rates</code>
          . Exceeding the limit returns
          {' '}
          <code>429 Too Many Requests</code>
          .
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          <b>Per-wallet access tokens</b>
          : most endpoints are public. You don&apos;t need an API key
          to hit
          {' '}
          <code>/status</code>
          ,
          {' '}
          <code>/rates</code>
          ,
          {' '}
          <code>POST /wallets</code>
          , or the QR image endpoint. But the two endpoints that read
          or modify an existing wallet (
          <code>GET /wallets/:address</code>
          {' '}
          and
          {' '}
          <code>DELETE /wallets/:address</code>
          ) require a per-wallet token in the
          {' '}
          <code>X-Wallet-Token</code>
          {' '}
          header. GRCpay hands the raw token back exactly once in the
          response to
          {' '}
          <code>POST /wallets</code>
          {' '}
          and only stores its SHA256 hash server-side, so if you lose
          the token you can&apos;t read the wallet again (you&apos;ll
          get a
          {' '}
          <code>401</code>
          , not a
          {' '}
          <code>404</code>
          , because GRCpay intentionally doesn&apos;t leak address
          existence to unauthenticated callers). Stash it alongside
          the address in whatever order record your integration
          keeps.
        </Typography>
      </Box>
    </Box>
  );
}
