import {
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import React from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function Operations() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="operations" sx={{ pb: 2 }}>
        Day-to-day operations
      </Typography>
      <Box component="article">
        <Typography variant="h6" component="h3" sx={{ pt: 1, pb: 1 }}>
          Updating
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`docker compose pull grcpay
docker compose up -d grcpay

# Or, for the docker run setup:
docker pull ghcr.io/gridcat/grcpay:latest
docker stop grcpay && docker rm grcpay
# … then re-run the docker run command from above.`}
        />
        <Typography gutterBottom variant="body1" component="p">
          GRCpay applies any pending Prisma migrations automatically on
          boot (
          <code>npx prisma migrate deploy</code>
          {' '}
          is the first thing the entrypoint runs), so you don&apos;t
          have to do anything special after pulling a new image.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Backups
        </Typography>
        <List dense>
          <ListItem disableGutters>
            <ListItemText
              primary="GRCpay's SQLite file"
              secondary="Snapshot ./grcpay-data/payment.db on a schedule. It contains your audit log and the order ↔ address mapping. Without it you can still reconcile by hand from the chain, but it's much easier with the file."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="The wallet's wallet.dat"
              secondary="Snapshot ./wallet-data/wallet.dat on a schedule. This is your actual money. The wallet auto-refills its keypool as GRCpay calls getnewaddress, so any backup taken before a fresh batch of addresses is generated will be missing those keys — schedule backups frequently, or pause GRCpay around the snapshot."
            />
          </ListItem>
        </List>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Logs
        </Typography>
        <CodeBlock
          caption="bash"
          language="bash"
          code={`docker logs -f grcpay
# or
docker compose logs -f grcpay`}
        />
        <Typography gutterBottom variant="body1" component="p">
          GRCpay logs every job-loop iteration, every wallet status
          transition, and every RPC error. The
          {' '}
          <code>db_logs</code>
          {' '}
          table inside the SQLite database also has a structured audit
          trail that&apos;s easier to query than raw container logs.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Common gotchas
        </Typography>
        <List dense>
          <ListItem disableGutters>
            <ListItemText
              primary='"Connecting to the gridcoin wallet…" on loop'
              secondary="The RPC handshake is failing. Almost always one of: wrong host/port, wrong rpcuser/rpcpassword, or rpcallowip not covering the source address. The wallet logs nothing for rejected connections by default — temporarily set debug=rpc in gridcoinresearch.conf to see why."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="Forwarding fails with 'Insufficient funds'"
              secondary="The wallet you forward from needs enough balance to cover the customer payment plus the network fee (default 0.001 GRC). If GRCpay is pointed at a fresh wallet that hasn't received any GRC of its own yet, top it up before going live."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="Wallet status stuck at 'new' after payment"
              secondary="Either the transaction hasn't confirmed yet (Gridcoin blocks are minted by staking nodes, so expect a few minutes of variance before a new tx lands in one), or GRCpay can't reach the wallet to refresh balances. Check the container logs for RPC errors."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="Wallet ends up in 'error' status"
              secondary="The expired-refund flow couldn't determine the original sender or the send call failed. The wallet stays parked for manual review — query the db_logs table for that wallet_id to see what went wrong, and refund manually if appropriate."
            />
          </ListItem>
        </List>
      </Box>
    </Box>
  );
}
