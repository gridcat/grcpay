import { Typography, Box } from '@mui/material';
import React from 'react';
import { NextMuiLink } from '@/components/NextMuiLink';

export function Privacy() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="privacy" sx={{ pb: 2 }}>
        Privacy
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          GRCpay is privacy-first by design. The API has no concept of accounts,
          there&apos;s no KYC, and no personal data is ever requested or stored.
          Each wallet is just a Gridcoin address, an expected amount, and an
          optional recipient — that&apos;s it.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The docs site you&apos;re reading uses
          {' '}
          <NextMuiLink href="https://github.com/plausible/analytics" rel="nofollow" color="primary">Plausible</NextMuiLink>
          {' '}
          for traffic analytics — no tracking pixels, no cookies, no Google
          Analytics. The tracking script can be disabled at deploy time via the
          {' '}
          <code>NEXT_PUBLIC_TRACK</code>
          {' '}
          flag.
        </Typography>
      </Box>
    </Box>
  );
}
