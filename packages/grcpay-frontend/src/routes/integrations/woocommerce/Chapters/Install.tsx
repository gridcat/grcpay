import React from 'react';
import { Typography, Box, Alert } from '@mui/material';
import { NextMuiLink } from '@/components/NextMuiLink';

export function Install() {
  return (
    <Box id="install" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Install
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Download the latest release of the GRCpay WooCommerce plugin and
          upload the ZIP through
          {' '}
          <i>WordPress admin → Plugins → Add new → Upload plugin</i>
          .
          Activate it the way you would activate any other WooCommerce
          extension.
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          The plugin download URL is
          {' '}
          <NextMuiLink href="https://TBD-wordpress-plugin-url/" rel="nofollow">
            TBD-wordpress-plugin-url
          </NextMuiLink>
          {' '}
          — replace this once the plugin is published.
        </Alert>
      </Box>
    </Box>
  );
}
