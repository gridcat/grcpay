import {
  Typography,
  Box,
  Alert,
  AlertTitle,
} from '@mui/material';

import React from 'react';
import { NextMuiLink } from '@/components/NextMuiLink';

export function Hosting() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="hosting" sx={{ pb: 2 }}>
        Self-host it (recommended)
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          GRCpay is open source and the
          {' '}
          <b>preferred way to run it is on your own infrastructure</b>
          , pointed at a Gridcoin wallet you control. You get a small,
          auditable Express service and a SQLite file. That&apos;s the
          whole stack.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Self-hosting is also what makes GRCpay genuinely non-custodial:
          your merchant funds never touch our wallet, our database, or
          our infrastructure. The only thing we&apos;d ever see is the
          docs site you&apos;re reading right now.
        </Typography>
        <Alert severity="success" variant="outlined" sx={{ my: 2 }}>
          <AlertTitle>Recommended: hot/cold wallet split</AlertTitle>
          For production, don&apos;t point GRCpay at your main merchant
          wallet directly. Give it a dedicated &ldquo;hot&rdquo; wallet
          on the same host, set the
          {' '}
          <code>recipient</code>
          {' '}
          field on every order to your real (cold) wallet, and let
          GRCpay forward funds onward as soon as a payment arrives. That
          way the wallet GRCpay can actually touch only ever holds a few
          minutes of in-transit balance — if the host is ever
          compromised, the blast radius is &ldquo;maybe one
          order&rdquo; instead of &ldquo;every GRC you&apos;ve ever
          earned.&rdquo; The
          {' '}
          <NextMuiLink href="/self-hosting#hot-cold" color="primary">
            Hot/cold wallet pattern
          </NextMuiLink>
          {' '}
          section in the self-hosting guide walks through the setup.
        </Alert>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          Using the public instance
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          We also run a public copy at
          {' '}
          <code>https://grcpay.gridcoin.club/api</code>
          {' '}
          that anyone can point their plugin or integration at. It&apos;s a
          fast way to try the protocol without standing up your own stack
          first, and it&apos;s the same code you&apos;d run yourself.
        </Typography>
        <Alert severity="warning" variant="outlined" sx={{ my: 2 }}>
          The public install is provided as a courtesy with
          {' '}
          <b>no SLA, no uptime guarantee, and no warranty</b>
          {' '}
          — see the
          {' '}
          <NextMuiLink href="/disclaimer#public-instance" color="primary">
            disclaimer
          </NextMuiLink>
          {' '}
          for the details. We strongly recommend running your own instance
          as soon as you go to production.
        </Alert>
      </Box>
    </Box>
  );
}
