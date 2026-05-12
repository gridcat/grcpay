import React from 'react';
import { Typography, Box } from '@mui/material';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function Errors() {
  return (
    <Box id="errors" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Errors
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Error responses follow the JSON:API error envelope. The HTTP status
          code is mirrored in the
          {' '}
          <code>status</code>
          {' '}
          field of each error object.
        </Typography>
        <CodeBlock
          caption="Example — 429 Too Many Requests"
          language="json"
          code={`{
  "errors": [
    {
      "status": "429",
      "title": "Too Many Requests",
      "detail": "Rate limit exceeded. Try again in 60 seconds."
    }
  ]
}`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Status codes you&apos;ll actually see
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              <code>200 OK</code>
              :
              {' '}
              successful GET.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>201 Created</code>
              : successful
              {' '}
              <code>POST /wallets</code>
              . The body contains the one-time
              {' '}
              <code>token</code>
              {' '}
              attribute you&apos;ll need for subsequent GETs and
              DELETEs.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>204 No Content</code>
              : successful
              {' '}
              <code>DELETE /wallets/:address</code>
              . The wallet is now
              {' '}
              <code>expired</code>
              {' '}
              and will be refunded on the next job cycle if it
              received any partial balance.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>400 Bad Request</code>
              : validation failed on the POST body (missing
              {' '}
              <code>amountRequired</code>
              , invalid base58 recipient, etc.).
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>401 Unauthorized</code>
              : you didn&apos;t send the
              {' '}
              <code>X-Wallet-Token</code>
              {' '}
              header, or the token you sent doesn&apos;t match.
              Returned identically in both cases so the endpoint
              can&apos;t be used to probe which addresses exist.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>404 Not Found</code>
              : the address genuinely doesn&apos;t exist (and you
              <i> did </i>
              authenticate).
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>409 Conflict</code>
              : you tried to
              {' '}
              <code>DELETE</code>
              {' '}
              a wallet that&apos;s past the
              {' '}
              <code>new</code>
              {' '}
              state. Cancellation is only valid on a wallet nobody has
              paid into yet. Once it&apos;s
              {' '}
              <code>funded</code>
              {' '}
              the funds are the merchant&apos;s and any refund has to
              happen out of band.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>429 Too Many Requests</code>
              : you&apos;re hitting the per-IP rate limit.
            </Typography>
          </li>
        </Box>
      </Box>
    </Box>
  );
}
