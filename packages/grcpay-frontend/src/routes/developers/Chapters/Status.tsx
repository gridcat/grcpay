import React from 'react';
import { Typography, Box } from '@mui/material';
import { Endpoint } from '@/components/Endpoint/Endpoint';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function Status() {
  return (
    <Box id="status" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Status
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Returns the service name and version. Cheap call — use it for health checks.
        </Typography>
        <Endpoint method="GET" path="/api/status" title="Service health" />
        <CodeBlock
          caption="Request"
          language="bash"
          code="curl https://grcpay.gridcoin.club/api/status"
        />
        <CodeBlock
          caption="Response — 200 OK"
          language="json"
          code={`{
  "data": {
    "type": "status",
    "attributes": {
      "name": "grcpay",
      "version": "1.0.0"
    }
  }
}`}
        />
      </Box>
    </Box>
  );
}
