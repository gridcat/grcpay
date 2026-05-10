import React from 'react';
import {
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';

export function Configure() {
  return (
    <Box id="configure" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Configure
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          The plugin adds a new payment method to
          {' '}
          <i>WooCommerce → Settings → Payments</i>
          . Open it and fill in just two fields:
        </Typography>
        <List>
          <ListItem>
            <ListItemText
              primary="GRCpay API URL"
              secondary="The base URL of your GRCpay backend, e.g. https://grcpay.example.com/api"
            />
          </ListItem>
          <ListItem>
            <ListItemText
              primary="Recipient address"
              secondary="Your merchant Gridcoin address. Funds are forwarded here automatically once a customer pays."
            />
          </ListItem>
        </List>
        <Typography gutterBottom variant="body1" component="p">
          Save and you&apos;re live. The plugin will mint a fresh payment
          wallet for each new order at checkout, render the QR code in the
          customer-facing receipt page, and update the order status as soon as
          GRCpay reports the payment as
          {' '}
          <code>processed</code>
          .
        </Typography>
      </Box>
    </Box>
  );
}
