import { Typography, Box } from '@mui/material';
import React from 'react';

export function Overview() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="overview" sx={{ pb: 2 }}>
        Overview
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          <b>GRCpay</b>
          {' '}
          is a self-hosted checkout facilitator for the Gridcoin network. For each
          customer order it asks the wallet daemon to mint a one-shot Gridcoin
          address, polls the daemon every few seconds to see how much has been
          received at it, and once the requested amount has arrived it forwards
          the payment to the merchant&apos;s wallet. No accounts, no custodial
          storage, no middlemen — just a transparent on-chain settlement layer
          that any merchant can run alongside their existing checkout.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The whole flow is built around a small REST API. Drop it in next to your
          ecommerce backend and you can accept Gridcoin payments in minutes; pair
          it with one of the upcoming plugins (
          <b>WooCommerce</b>
          {' '}
          first) and there&apos;s no integration work at all.
        </Typography>
      </Box>
    </Box>
  );
}
