import React from 'react';
import { Typography, Box } from '@mui/material';
import { Endpoint } from '@/components/Endpoint/Endpoint';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';
import { SITE_URL } from '@/components/Seo';

export function Rates() {
  return (
    <Box id="rates" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Rates
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Convenience pass-through to CoinGecko, cached for 5 minutes per
          currency. Use it to convert a fiat price to a GRC amount before
          creating a wallet.
        </Typography>

        <Endpoint method="GET" path="/api/rates" title="Supported currencies" />
        <CodeBlock
          caption="Request"
          language="bash"
          code={`curl ${SITE_URL}/api/rates`}
        />

        <Endpoint method="GET" path="/api/rates/:currency" title="GRC price in fiat" />
        <CodeBlock
          caption="Request"
          language="bash"
          code={`curl ${SITE_URL}/api/rates/usd`}
        />
        <CodeBlock
          caption="Response — 200 OK"
          language="json"
          code={`{
  "data": {
    "type": "rates",
    "id": "usd",
    "attributes": {
      "currency": "usd",
      "rate": 0.0023,
      "coin": "gridcoin-research",
      "ticker": "grc"
    }
  }
}`}
        />
      </Box>
    </Box>
  );
}
