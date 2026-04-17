import { Typography, Box } from '@mui/material';
import React from 'react';

export function Settlement() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="settlement" sx={{ pb: 2 }}>
        Settlement
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          When a wallet&apos;s balance reaches the requested amount,
          GRCpay settles it. &ldquo;Settle&rdquo; means two things: if the
          customer paid more than was asked for, refund the excess to
          them; then forward exactly the required amount to the
          merchant&apos;s recipient address (minus the standard Gridcoin
          network fee — currently 0.001 GRC per transaction). The
          merchant always gets exactly what they asked for, not whatever
          happened to land in the wallet. Any overpayment goes back to
          the customer who caused it, which is how honest typos and
          stale fiat→GRC conversions get handled automatically instead
          of silently disappearing into the merchant&apos;s balance.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          All amounts are tracked in halford precision (1 GRC =
          100,000,000 halford) to avoid floating-point rounding
          surprises, and only converted to GRC for display and for RPC
          calls to the wallet daemon. The full
          {' '}
          <a href="#refunds">refund flow</a>
          {' '}
          section below has the details on how the refund side works,
          including the dust and sender-not-found edge cases.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          If no recipient was supplied at creation time, the wallet is
          simply marked
          {' '}
          <code>processed</code>
          {' '}
          and the funds remain at the address — useful when the merchant
          prefers to sweep balances manually. Overpayment refunds still
          happen in this case; only the forward-to-merchant step is
          skipped.
        </Typography>
      </Box>
    </Box>
  );
}
