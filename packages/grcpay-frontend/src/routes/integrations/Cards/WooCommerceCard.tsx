import React from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Typography,
} from '@mui/material';
import Link from 'next/link';

export function WooCommerceCard() {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea
        component={Link}
        href="/integrations/woocommerce"
        sx={{ height: '100%' }}
      >
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h6" component="h3">
              WooCommerce
            </Typography>
            <Chip
              label="Live"
              color="success"
              size="small"
              sx={{ fontWeight: 700 }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', pt: 1 }}>
            Drop-in WordPress plugin. Adds Gridcoin as a payment method to any
            WooCommerce checkout, with one-click test-install on a hosted demo
            store.
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
