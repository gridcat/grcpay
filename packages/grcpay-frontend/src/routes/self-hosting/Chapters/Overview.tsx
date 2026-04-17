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
          This page walks through running GRCpay on your own
          infrastructure. Two flavours are covered: pointing GRCpay at a
          Gridcoin wallet you already operate, and standing up the whole
          stack (wallet + GRCpay) from scratch with Docker Compose.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Both setups give you the same thing: a small REST service that
          your checkout (or one of the upcoming plugins) can call to mint
          payment addresses, and a wallet daemon on the back that stays
          private to your network. The whole footprint is a Node.js
          process and a SQLite file on the GRCpay side, plus whatever
          your wallet daemon needs.
        </Typography>
      </Box>
    </Box>
  );
}
