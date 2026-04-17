import React from 'react';
import {
  Typography,
  Box,
  Alert,
  Button,
} from '@mui/material';
import LaunchIcon from '@mui/icons-material/Launch';

const TEST_INSTALL_URL = 'https://TBD-woo-demo.example.com/';

export function TestInstall() {
  return (
    <Box id="test-install" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Try it live
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          We host a sandbox WooCommerce store with the GRCpay plugin
          pre-configured. Add a test product to your cart, hit the checkout,
          and watch the on-chain payment flow end-to-end before you install
          anything yourself.
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          The sandbox runs against a testnet wallet. Do not send mainnet GRC.
        </Alert>
        <Button
          variant="contained"
          color="primary"
          endIcon={<LaunchIcon />}
          href={TEST_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the demo store
        </Button>
        <Typography variant="caption" component="p" sx={{ pt: 1, color: 'text.secondary' }}>
          Demo URL:
          {' '}
          <code>{TEST_INSTALL_URL}</code>
          {' '}
          (TBD — replace once the sandbox is hosted).
        </Typography>
      </Box>
    </Box>
  );
}
