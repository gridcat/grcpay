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
        <Typography gutterBottom variant="body1" component="p">
          If you cancel an order the customer has already paid (say, you
          agreed a new price and are re-issuing it), GRCpay returns the
          buyer&apos;s funds automatically. The plugin tracks the
          original wallet to its
          {' '}
          <code>refunded</code>
          {' '}
          state and notes the refund on the order timeline, so there is
          no manual step. A partial payment that doesn&apos;t yet cover
          the invoice keeps the checkout visible so the customer can send
          the rest, instead of prematurely showing a
          &quot;payment processing&quot; screen.
        </Typography>
      </Box>
    </Box>
  );
}
