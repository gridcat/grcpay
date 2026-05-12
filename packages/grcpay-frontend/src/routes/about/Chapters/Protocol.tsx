import {
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import React from 'react';

const states: { name: string; description: string }[] = [
  {
    name: 'new',
    description:
      'Wallet just created, or still waiting for enough funds to cover the invoice. GRCpay polls the wallet daemon for both the confirmed balance and the 0-conf mempool balance on each tick; anything still unconfirmed is tracked as amountPending.',
  },
  {
    name: 'confirming',
    description:
      'The customer has deposited enough GRC to cover the invoice when counting the confirmed balance AND the 0-conf pending balance, but the confirmed portion hasn\'t yet reached MIN_CONFIRMATIONS blocks. This is the right state to render a "payment detected, waiting for confirmations" banner to the customer so they don\'t re-send. Transitions forward to funded when the confirmed balance actually meets the invoice, or backward to new if a pending tx drops out of the mempool (reorg, low-fee replacement).',
  },
  {
    name: 'funded',
    description:
      'The required amount has been CONFIRMED (not just mempool-detected). If the customer overpaid, GRCpay refunds the excess to them first; then, if a recipient address was supplied at creation time, it forwards exactly the required amount to the merchant. Same-block reorgs can\'t flip a wallet into this state because amountRecieved only reflects the confirmed portion.',
  },
  {
    name: 'processed',
    description:
      "Payment has been forwarded to the recipient (or marked complete if no recipient was given). This is the success terminal state. If an overpayment was refunded along the way, the refund txid is in the wallet record's refundTx field and the amount in refundAmount.",
  },
  {
    name: 'expired',
    description:
      'The wallet aged out before being fully funded (default lifespan is 2 hours). GRCpay will attempt to refund any partial balance to the original sender.',
  },
  {
    name: 'refunded',
    description:
      'After the wallet expired, GRCpay walked the transaction history and successfully returned each sender their original contribution (minus the per-refund network fee). Wallets with multiple senders see one refund tx per sender.',
  },
  {
    name: 'norefund',
    description:
      'Wallet expired with no balance to return. Terminal state, nothing further to do.',
  },
  {
    name: 'error',
    description:
      'Something went wrong during processing. The wallet is parked for manual inspection.',
  },
];

export function Protocol() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="protocol" sx={{ pb: 2 }}>
        Protocol & Lifecycle
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Every payment wallet moves through a small state machine. The status is
          exposed on every wallet record returned by the API so your integration can
          react to changes without having to interpret raw blockchain data.
        </Typography>
        <Typography
          gutterBottom
          variant="body2"
          component="pre"
          sx={{
            fontFamily: 'monospace',
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            p: 2,
            borderRadius: 1,
            overflowX: 'auto',
          }}
        >
          {`new ──▶ confirming ──▶ funded ──▶ processed
  │       │
  │       └──▶ new  (mempool drop / reorg)
  │
  └─▶ expired ──▶ refunded
              └─▶ norefund`}
        </Typography>
        <List dense>
          {states.map((s) => (
            <ListItem key={s.name} disableGutters>
              <ListItemText
                primary={(
                  <Typography component="span" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    {s.name}
                  </Typography>
                )}
                secondary={s.description}
              />
            </ListItem>
          ))}
        </List>
      </Box>
    </Box>
  );
}
