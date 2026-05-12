import React from 'react';
import { Typography, Box, Alert } from '@mui/material';
import Link from 'next/link';
import { SITE_URL, SITE_HOST } from '@/components/Seo';

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
          documents. No API keys, no accounts. Reads and cancels on a specific
          wallet use a per-wallet token returned once at creation; everything else
          is public. The entire flow can be driven from a half-dozen endpoints.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The API base URL depends on how you deploy. On this deployment at
          {' '}
          <code>{SITE_HOST}</code>
          {' '}
          the API is mounted under
          {' '}
          <code>/api</code>
          {' '}
          (so e.g.
          {' '}
          <code>{`${SITE_URL}/api/wallets`}</code>
          ). Running locally with
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
          <code>{`${SITE_HOST}/api`}</code>
          {' '}
          install is free for now and provided as-is. No SLA, no warranty
          (see the
          {' '}
          <Link href="/disclaimer#public-instance" style={{ color: 'inherit' }}>disclaimer</Link>
          ). The recommended way to use GRCpay in production is to
          {' '}
          <Link href="/about#hosting" style={{ color: 'inherit' }}>run your own instance</Link>
          {' '}
          against your own Gridcoin wallet.
        </Alert>
      </Box>
    </Box>
  );
}
