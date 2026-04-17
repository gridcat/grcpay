import React from 'react';
import { Typography, Box } from '@mui/material';
import { Endpoint } from '@/components/Endpoint/Endpoint';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function Qr() {
  return (
    <Box id="qr" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        QR Codes
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Returns a JSON:API document whose
          {' '}
          <code>qr</code>
          {' '}
          attribute is a base64-encoded PNG data URL. Fetch the JSON, pull
          out the
          {' '}
          <code>data.attributes.qr</code>
          {' '}
          field, and feed the data URL straight to an
          {' '}
          <code>{'<img>'}</code>
          {' '}
          tag — no client-side QR library required.
        </Typography>
        <Endpoint
          method="GET"
          path="/api/wallets/:address/qr?filter[width]=256"
          title="QR data URL for an address"
        />
        <CodeBlock
          caption="Request"
          language="bash"
          code="curl https://grcpay.gridcoin.club/api/wallets/SXxxx.../qr?filter[width]=256"
        />
        <CodeBlock
          caption="Response — 200 OK"
          language="json"
          code={`{
  "data": {
    "type": "qrs",
    "id": "SXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "attributes": {
      "qr": "data:image/png;base64,iVBORw0KGgoAAAANS..."
    }
  }
}`}
        />
        <CodeBlock
          caption="Browser usage"
          language="javascript"
          code={`const res = await fetch(
  'https://grcpay.gridcoin.club/api/wallets/SXxxx.../qr',
);
const json = await res.json();
imgEl.src = json.data.attributes.qr;`}
        />
        <Typography gutterBottom variant="body1" component="p" sx={{ color: 'text.secondary' }}>
          The
          {' '}
          <code>filter[width]</code>
          {' '}
          query parameter is optional — defaults to 256 pixels, must be
          between 1 and 999.
        </Typography>
      </Box>
    </Box>
  );
}
