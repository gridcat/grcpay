import { Typography, Box } from '@mui/material';
import React from 'react';

export function Refunds() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="refunds" sx={{ pb: 2 }}>
        Refunds
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          GRCpay refunds funds back to customers in three different
          situations, each with slightly different semantics. In all of
          them, the refund side is best-effort: GRCpay tries hard to do
          the right thing, and when it genuinely can&apos;t (sender
          unknown, dust amount, RPC error) it degrades gracefully
          rather than parking the wallet in limbo.
        </Typography>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          Overpayment refunds
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          When a customer sends
          <i> more </i>
          GRC than the wallet&apos;s required amount (a typo, a stale
          fiat→GRC conversion, or an off-by-one somewhere in their
          checkout) GRCpay detects the overpayment at settlement time
          and refunds the excess to the sender before forwarding the
          required amount to the merchant.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The refund goes to the
          <i> latest </i>
          contributor, the account whose payment pushed the wallet
          over the required amount. This is almost always the customer
          who caused the overpayment in the first place. Their net cost
          ends up being
          {' '}
          <code>required + MIN_FEE</code>
          {' '}
          (they pay for the refund tx themselves, which feels fair: the
          merchant shouldn&apos;t be penalised for their typo).
          The merchant gets exactly
          {' '}
          <code>required - MIN_FEE</code>
          , the same as on a clean payment.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Three corner cases where the refund doesn&apos;t happen and
          the merchant ends up absorbing the overpayment as a tip
          instead:
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              <b>Dust overpayment.</b>
              {' '}
              If the overpayment is smaller than the network fee (e.g.
              the customer paid 10.0005 GRC for a 10 GRC order), issuing
              a refund would cost more than it returns. Skipped. The
              merchant gets the tiny tip.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>Sender can&apos;t be determined.</b>
              {' '}
              If GRCpay can&apos;t walk the transaction history back to
              a usable sender address, it can&apos;t issue the refund.
              This is rare but possible with unusual wallet setups. The
              overpayment is absorbed into the merchant payout.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>Refund tx itself fails, persistently.</b>
              {' '}
              If the refund RPC call throws (wallet locked, network
              glitch, etc.) GRCpay does
              <i> not </i>
              immediately give up and forward the money to the merchant.
              Instead the wallet stays in
              {' '}
              <code>funded</code>
              {' '}
              and the failure is retried with exponential backoff
              (default intervals 30s, 1m, 2m, 4m) across the next few
              job-loop cycles. That window gives a real human operator
              time to actually unlock the daemon (the usual root cause)
              before we declare the refund hopeless. Only after the
              retry cap (default 5 attempts) is exhausted does GRCpay
              fall back to forwarding the full balance so the merchant
              payout is never blocked indefinitely.
            </Typography>
          </li>
        </Box>
        <Typography gutterBottom variant="body1" component="p">
          When a refund
          <i> does </i>
          go through, the refund txid is recorded on the wallet record
          in the
          {' '}
          <code>refundTx</code>
          {' '}
          field, and the actual GRC amount returned to the customer is
          in
          {' '}
          <code>refundAmount</code>
          . Plugin authors can surface either one to the merchant in
          their order details screen.
        </Typography>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          Expired-wallet refunds
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          If a wallet expires with a non-zero balance (the customer
          paid late, or the order sat open too long without reaching
          its target) GRCpay walks the full transaction history and
          refunds
          <i> each </i>
          contributor the amount they originally sent, minus the
          per-refund network fee. A wallet that received contributions
          from multiple senders sees multiple refund transactions, one
          per sender.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Final wallet status depends on what happened:
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              <code>refunded</code>
              : at least one refund went out and none failed. The
              wallet record&apos;s
              {' '}
              <code>tx_out</code>
              {' '}
              holds the first refund txid; the total GRC returned is in
              {' '}
              <code>refundAmount</code>
              ; full per-sender details are in the audit log.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>norefund</code>
              : every contribution was below the network fee threshold.
              Refunding any of them would net-negative the wallet, so
              nothing is attempted. Terminal state, operator doesn&apos;t
              need to do anything.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <code>error</code>
              : either no senders could be identified at all, or at
              least one refund RPC call threw. Any refunds that
              <i> did </i>
              succeed are still recorded, but the wallet is parked for
              an operator to check the audit log and decide what to do
              with the remainder.
            </Typography>
          </li>
        </Box>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          Late-payment refunds
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          A trickier edge case: what happens when a customer sends GRC
          to a wallet that has
          <i> already </i>
          settled? Picture a shopper who opens a checkout page, walks
          away for an hour, and eventually clicks &ldquo;pay&rdquo; on a
          stale tab. By that point the order has either been
          completed by someone else, expired, or been cancelled by the
          merchant. Without special handling, that GRC would sit
          silently in GRCpay&apos;s hot wallet and the customer would
          lose it.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          GRCpay runs a dedicated late-payment sweep on a separate slow
          timer (default once an hour, configurable via the
          {' '}
          <code>LATE_PAYMENT_CHECK_INTERVAL</code>
          {' '}
          env var; set it to
          {' '}
          <code>0</code>
          {' '}
          to turn the sweep off entirely). For every terminal-state
          wallet whose
          {' '}
          <code>updated_at</code>
          {' '}
          is within the last 7 days (the
          {' '}
          <code>LATE_PAYMENT_WINDOW</code>
          , also env-tunable), it asks the daemon for the current
          balance, compares it against the last amount GRCpay recorded,
          and refunds the difference to the latest sender, minus the
          per-tx fee, same economics as the overpayment flow.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          Past the 7-day window the wallet is considered cold: any
          stale browser session or cached checkout page is long gone,
          and late deliveries into that address stay in the hot wallet
          for a human operator to sweep manually. Customers who have
          genuinely been sitting on a GRCpay address for a month should
          be reaching out to the merchant through normal channels
          anyway.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The rules are otherwise identical to overpayment refunds:
          dust amounts are absorbed into the hot wallet (not worth the
          fee), sender-not-found cases are logged and left alone, and
          refund RPC failures retry with the same exponential backoff
          before giving up. Every successful late refund appears in
          {' '}
          <code>db_logs</code>
          {' '}
          under the
          {' '}
          <code>late_refund</code>
          {' '}
          action, and the wallet&apos;s
          {' '}
          <code>refundAmount</code>
          {' '}
          is bumped cumulatively so merchants can always see the total
          GRC ever returned through that address.
        </Typography>
      </Box>
    </Box>
  );
}
