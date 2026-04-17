import React from 'react';
import { Typography, Box, Alert } from '@mui/material';
import Link from 'next/link';

export function Overview() {
  return (
    <Box id="overview" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Overview
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          The GRCpay API is a small REST surface that returns
          {' '}
          <code>application/vnd.api+json</code>
          {' '}
          documents. There&apos;s no auth — by design — and the entire flow can be
          driven from a half-dozen endpoints.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The API base URL depends on how you deploy. In production at
          {' '}
          <code>grcpay.gridcoin.club</code>
          {' '}
          the API is mounted under
          {' '}
          <code>/api</code>
          {' '}
          (so e.g.
          {' '}
          <code>https://grcpay.gridcoin.club/api/wallets</code>
          ). When running locally with
          {' '}
          <code>docker-compose up grcpay</code>
          {' '}
          the backend listens directly on port
          {' '}
          <code>7001</code>
          .
        </Typography>
        <Alert severity="info" variant="outlined" sx={{ my: 2 }}>
          <b>Heads up:</b>
          {' '}
          the public
          {' '}
          <code>grcpay.gridcoin.club/api</code>
          {' '}
          install is free for now and provided as-is — no SLA, no warranty.
          The recommended way to use GRCpay in production is to
          {' '}
          <Link href="/about#hosting" style={{ color: 'inherit' }}>run your own instance</Link>
          {' '}
          against your own Gridcoin wallet. See the
          {' '}
          <Link href="/about#hosting" style={{ color: 'inherit' }}>hosting policy</Link>
          {' '}
          for the details.
        </Alert>
      </Box>
    </Box>
  );
}
