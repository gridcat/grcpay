import React from 'react';
import {
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';

interface Row {
  scenario: string;
  received: string;
  refunded: string;
  forwarded: string;
  refundTxField: string;
  notes: string;
}

const rows: Row[] = [
  {
    scenario: 'Exact payment',
    received: '10 GRC',
    refunded: '—',
    forwarded: '9.999 GRC',
    refundTxField: 'null',
    notes: 'No overpayment, no refund, merchant gets required − fee.',
  },
  {
    scenario: 'Overpayment (refundable)',
    received: '12 GRC',
    refunded: '1.999 GRC',
    forwarded: '9.999 GRC',
    refundTxField: 'set',
    notes:
      'Overpayment > fee. Latest sender receives (overpayment − fee) back. Merchant still gets required − fee.',
  },
  {
    scenario: 'Dust overpayment',
    received: '10.0005 GRC',
    refunded: '—',
    forwarded: '9.9995 GRC',
    refundTxField: 'null',
    notes:
      'Overpayment ≤ fee. Refunding would net-negative. Skipped, merchant absorbs the tip.',
  },
  {
    scenario: 'Sender cannot be determined',
    received: '12 GRC',
    refunded: '—',
    forwarded: '11.999 GRC',
    refundTxField: 'null',
    notes:
      'Rare. Transaction-history walk fails to find a usable sender. Overpayment absorbed into the merchant forward.',
  },
  {
    scenario: 'Refund tx fails (within retry budget)',
    received: '12 GRC',
    refunded: 'deferred',
    forwarded: '(not yet)',
    refundTxField: 'null',
    notes:
      'Refund RPC threw. Wallet stays funded, refund_attempts bumped, retried on the next cycle with exponential backoff (30s, 1m, 2m, 4m). Merchant payout is held until the refund either succeeds or the retry cap is exhausted. Rationale: don\'t commit to forwarding the merchant\'s cut before we\'ve given the customer\'s refund a real chance.',
  },
  {
    scenario: 'Refund tx fails (retries exhausted)',
    received: '12 GRC',
    refunded: '—',
    forwarded: '11.999 GRC',
    refundTxField: 'null',
    notes:
      'After MAX_REFUND_ATTEMPTS (default 5) the refund is abandoned and the full balance is forwarded to the merchant so the payout isn\'t blocked indefinitely. Customer absorbs the mistake. The attempts are visible in db_logs under overpayment_refund_failed.',
  },
  {
    scenario: 'Forward tx fails',
    received: '10 GRC',
    refunded: '—',
    forwarded: '(not sent)',
    refundTxField: 'null',
    notes: 'Wallet transitions to error for manual operator review.',
  },
];

export function FeeMath() {
  return (
    <Box id="fee-math" sx={{ pb: 4 }}>
      <Typography variant="h4" component="h2" sx={{ pb: 2 }}>
        Fee and refund math
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Settlement amounts follow a simple rule:
          {' '}
          <b>GRCpay always pays the per-tx network fee out of the
          amount being sent</b>
          , never on top of it. That applies equally to merchant
          forwards and to customer refunds. Whoever&apos;s receiving
          the tx also bears the fee for it.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The network fee is currently
          {' '}
          <code>0.001 GRC</code>
          {' '}
          per transaction (the
          {' '}
          <code>MIN_FEE</code>
          {' '}
          constant in the backend config). Multiply by two whenever
          you see both a refund and a forward happen on the same
          wallet.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Every scenario, same row format
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Each row assumes an
          {' '}
          <code>amountRequired</code>
          {' '}
          of 10 GRC and a
          {' '}
          <code>recipient</code>
          {' '}
          that was supplied at wallet creation time. Numbers round to
          halford precision.
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ my: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Scenario</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Received</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Refunded to customer</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Forwarded to merchant</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>refundTx field</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.scenario}>
                  <TableCell sx={{ fontWeight: 600, verticalAlign: 'top' }}>{r.scenario}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', verticalAlign: 'top' }}>{r.received}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', verticalAlign: 'top' }}>{r.refunded}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', verticalAlign: 'top' }}>{r.forwarded}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', verticalAlign: 'top' }}>{r.refundTxField}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', verticalAlign: 'top' }}>{r.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Invariant the merchant can count on
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          On the happy path (exact or refundable overpayment), the
          merchant always receives exactly
          {' '}
          <code>amountRequired − MIN_FEE</code>
          . Plugin UIs can display &ldquo;you paid X, merchant got X
          minus the network fee&rdquo; with confidence. The absorb-
          into-tip cases (dust, sender unknown, refund tx fails) give
          the merchant slightly
          <i> more </i>
          than the required amount, never less. The only scenario
          where the merchant gets
          <i> less </i>
          than
          {' '}
          <code>required − fee</code>
          {' '}
          is when the forward tx itself fails, and in that case the
          wallet transitions to
          {' '}
          <code>error</code>
          {' '}
          so the merchant knows to look into it.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Expired-wallet refunds (multi-sender)
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          A wallet that never reached its target and times out takes a
          different path: each contributor gets back what they
          originally sent, minus the per-refund network fee. If a
          wallet received contributions from three different senders,
          the expired-refund flow broadcasts
          <i> three </i>
          refund transactions, each consuming 0.001 GRC in fees. The
          first refund txid lands in
          {' '}
          <code>txOut</code>
          ; the
          <i> total </i>
          halford refunded across all senders lands in
          {' '}
          <code>refundAmount</code>
          ; and every individual refund tx is recorded in
          {' '}
          <code>db_logs</code>
          {' '}
          under the
          {' '}
          <code>expired_refund</code>
          {' '}
          action if you want the full trail.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Per-sender dust (where a single sender&apos;s contribution
          is smaller than the refund fee) is silently skipped. If
          every sender&apos;s contribution is below the fee, the
          wallet transitions to
          {' '}
          <code>norefund</code>
          {' '}
          instead of
          {' '}
          <code>refunded</code>
          . If any of the per-sender refund txs fail, the wallet
          transitions to
          {' '}
          <code>error</code>
          {' '}
          regardless of how many others succeeded. The operator should
          check
          {' '}
          <code>db_logs</code>
          {' '}
          for the wallet_id to see what went through and what
          didn&apos;t.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Late payments on terminal wallets
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          A wallet that&apos;s already settled (
          <code>processed</code>
          ,
          {' '}
          <code>refunded</code>
          , or
          {' '}
          <code>norefund</code>
          ) can still have GRC arrive late: a customer paying from a
          stale checkout tab, a shopper who saved the address and came
          back an hour later, a merchant pulling the plug on an order
          that was already in flight. GRCpay runs a separate slow
          sweep (default once an hour,
          {' '}
          <code>LATE_PAYMENT_CHECK_INTERVAL</code>
          ) over all terminal wallets last touched within the past 7
          days (
          <code>LATE_PAYMENT_WINDOW</code>
          ), compares the on-chain balance against the DB&apos;s
          {' '}
          <code>amountRecieved</code>
          , and refunds any delta to the latest sender minus the fee.
          Same dust/no-sender absorption rules as the overpayment
          flow. Each successful late refund bumps the wallet&apos;s
          {' '}
          <code>refundAmount</code>
          {' '}
          cumulatively and lands an
          {' '}
          <code>late_refund</code>
          {' '}
          entry in
          {' '}
          <code>db_logs</code>
          . Past 7 days the wallet is considered cold and late funds
          stay in the hot wallet for an operator to sweep. Operators
          who don&apos;t want this sweep at all can set
          {' '}
          <code>LATE_PAYMENT_CHECK_INTERVAL=0</code>
          {' '}
          to disable it.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Merchant-initiated cancellation
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          If an order needs to be cancelled while the wallet is still
          {' '}
          <code>new</code>
          {' '}
          (item sold out, customer abandoned checkout, merchant just
          changed their mind), the integration can call
          {' '}
          <code>DELETE /wallets/:address</code>
          {' '}
          with the per-wallet access token. GRCpay flips the wallet
          straight to
          {' '}
          <code>expired</code>
          , and the existing expired-refund flow returns any partial
          balance on the next job cycle (same multi-sender semantics).
          Cancellation is rejected with
          {' '}
          <code>409 Conflict</code>
          {' '}
          on anything past
          {' '}
          <code>new</code>
          . Once funds are in, they&apos;re either already on their
          way to the merchant or already being refunded.
        </Typography>
      </Box>
    </Box>
  );
}
