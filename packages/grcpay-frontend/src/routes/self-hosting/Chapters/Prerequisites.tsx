import {
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import React from 'react';

export function Prerequisites() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="prerequisites" sx={{ pb: 2 }}>
        Prerequisites
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          You need:
        </Typography>
        <List dense>
          <ListItem disableGutters>
            <ListItemText
              primary="A server with Docker installed"
              secondary="Any small VPS works. GRCpay itself is tiny: &lt;100 MB RAM, &lt;100 MB disk for the SQLite file. A Gridcoin wallet container, if you run one alongside, is the heavier piece (a few GB of chain data once synced)."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="A Gridcoin wallet you control"
              secondary="Either an existing gridcoinresearchd you already operate, or a fresh wallet you'll start in a container. GRCpay never holds funds itself. Every address it mints belongs to your wallet."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="An RPC username and password for the wallet"
              secondary="Set in the wallet's gridcoinresearch.conf as rpcuser / rpcpassword. GRCpay uses these to make JSON-RPC calls. They should be long, random, and known only to GRCpay and the wallet daemon."
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemText
              primary="(Optional) a public hostname and TLS certificate"
              secondary="If you want a checkout to reach GRCpay over the internet, terminate TLS at a reverse proxy in front of it. We show an nginx example below."
            />
          </ListItem>
        </List>
      </Box>
    </Box>
  );
}
