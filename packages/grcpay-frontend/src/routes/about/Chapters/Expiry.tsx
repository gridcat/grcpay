import { Typography, Box } from '@mui/material';
import React from 'react';

export function Expiry() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="expiry" sx={{ pb: 2 }}>
        Expiry & Background Jobs
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Each wallet has a configurable lifespan (default: 2 hours). A background
          job loop runs every 10 seconds and walks every active wallet through five
          steps in sequence: refresh balances → mark funded → mark expired → forward
          funded payments → process expired refunds.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The single sequential loop keeps the moving parts auditable: every status
          transition is written to a
          {' '}
          <code>db_logs</code>
          {' '}
          audit table, so it&apos;s
          straightforward to reconstruct a wallet&apos;s timeline from the database
          alone — no extra event store required.
        </Typography>
      </Box>
    </Box>
  );
}
