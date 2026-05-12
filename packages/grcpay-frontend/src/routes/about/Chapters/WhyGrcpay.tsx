import { Typography, Box } from '@mui/material';
import React from 'react';
import { NextMuiLink } from '@/components/NextMuiLink';

export function WhyGrcpay() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="why" sx={{ pb: 2 }}>
        Why does GRCpay need to exist?
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          Bitcoin has
          {' '}
          <NextMuiLink href="https://btcpayserver.org/" color="primary">BTCPay Server</NextMuiLink>
          , a self-hosted, non-custodial payment processor you can drop in
          front of any checkout. Gridcoin doesn&apos;t. Gridcoin isn&apos;t
          on BTCPay&apos;s altcoin support list, and it doesn&apos;t appear
          on the
          {' '}
          <NextMuiLink href="https://github.com/alexk111/awesome-bitcoin-payment-processors" color="primary">awesome-bitcoin-payment-processors</NextMuiLink>
          {' '}
          curated list either. The stock wallet daemon (
          <code>gridcoinresearchd</code>
          ) is a full node with a JSON-RPC interface, and that&apos;s where
          it stops. A merchant who wants to accept GRC has to build the rest
          of the plumbing themselves before a customer can click &ldquo;Pay
          with GRC&rdquo; in a store. GRCpay
          <i> is </i>
          that rest-of-the-plumbing.
        </Typography>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          What you have to build on top of the daemon
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          The wallet daemon is exactly that: a wallet. It does its job
          well, managing keys, keeping its view of the chain in sync,
          tracking which addresses belong to it, and sending GRC when
          asked. It also stays cleanly within that remit, and
          that&apos;s the right design call. Running a checkout is a
          different layer of plumbing, and a wallet daemon
          shouldn&apos;t pretend otherwise.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          What you get from
          {' '}
          <code>gridcoinresearchd</code>
          {' '}
          is a clean JSON-RPC surface:
          {' '}
          <code>getnewaddress</code>
          {' '}
          mints an address,
          {' '}
          <code>getreceivedbyaddress</code>
          {' '}
          reports how much has arrived at one,
          {' '}
          <code>sendtoaddress</code>
          {' '}
          sends a transaction. The daemon keeps its internal ledger up to
          date as new blocks come in, and then waits to be asked. Every
          action is initiated by an explicit RPC call from outside, which
          is exactly what you want from a wallet: predictable, auditable,
          no surprises. The flip side is that anything checkout-shaped
          (orders, expiry, forwarding, customer-facing webhooks) has to
          live somewhere else. The higher layer ends up owning:
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              <b>Order ↔ address mapping.</b>
              {' '}
              The daemon stores addresses but has no idea which order or
              customer they belong to. You need your own database to
              remember &ldquo;address SXxx is order #1234, expects 10 GRC.&rdquo;
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>A polling loop.</b>
              {' '}
              You have to call
              {' '}
              <code>getreceivedbyaddress</code>
              {' '}
              for every open order, on a schedule, and decide when an order
              counts as &ldquo;funded.&rdquo; GRCpay runs this loop every
              10 seconds against every wallet still in
              {' '}
              <code>new</code>
              {' '}
              status.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>A lifecycle state machine.</b>
              {' '}
              <code>new → funded → processed</code>
              , with
              {' '}
              <code>expired → refunded / norefund / error</code>
              {' '}
              for orders that age out. Refunds in particular need
              transaction-history walking. GRCpay calls
              {' '}
              <code>listtransactions</code>
              {' '}
              and
              {' '}
              <code>getrawtransaction</code>
              {' '}
              to find the original sender of an expired wallet&apos;s
              funds, and falls back to an
              {' '}
              <code>error</code>
              {' '}
              status for manual review when it can&apos;t.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>A real HTTP API.</b>
              {' '}
              The wallet only speaks JSON-RPC over HTTP basic auth, which
              is fine for sysadmins and awkward for plugging into a web
              checkout. No JSON:API conventions, no CORS, no rate limits,
              no QR endpoint, no audit log.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>Settlement.</b>
              {' '}
              If the merchant wants funds forwarded to a cold wallet, you
              need to fetch the balance, set the fee, and send a
              transaction, all wrapped in retry logic for transient RPC
              errors.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              <b>Keypool refills on demand.</b>
              {' '}
              The daemon pre-generates a fixed buffer of keys (
              <code>DEFAULT_KEYPOOL_SIZE = 100</code>
              {' '}
              in
              {' '}
              <code>src/wallet/wallet.h</code>
              ). A busy merchant burns through that quickly and has to
              call
              {' '}
              <code>keypoolrefill</code>
              {' '}
              by hand. GRCpay handles the refill automatically every time
              {' '}
              <code>getnewaddress</code>
              {' '}
              fails.
            </Typography>
          </li>
        </Box>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          What GRCpay actually adds
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          GRCpay is the thin layer that fills exactly that gap. It speaks
          JSON-RPC to
          {' '}
          <code>gridcoinresearchd</code>
          {' '}
          on one side and exposes a small JSON:API REST surface on the
          other, with the order-tracking database, polling loop, lifecycle
          state machine, refund flow, keypool refill, QR generation, and
          rate limiting all built in. It&apos;s the missing
          payment-processor layer that turns the wallet daemon into
          something a checkout can talk to.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          It doesn&apos;t bypass any wallet limitations. There&apos;s no
          magic. It packages all the plumbing every merchant would
          otherwise have to write themselves into one open-source service
          that anyone can run against their own wallet.
        </Typography>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          A smaller attack surface
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          There&apos;s a quiet but real security win that comes for free
          with this architecture: putting GRCpay in front of
          {' '}
          <code>gridcoinresearchd</code>
          {' '}
          means you never expose the wallet&apos;s JSON-RPC interface to
          the internet. The full wallet RPC includes commands like
          {' '}
          <code>dumpprivkey</code>
          ,
          {' '}
          <code>walletpassphrase</code>
          , and
          {' '}
          <code>sendtoaddress</code>
          . Anyone who reaches the RPC port with the right credentials can
          dump keys or drain the wallet outright.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          GRCpay&apos;s public REST surface is deliberately narrow: create
          a payment wallet (validated input, no funds moved), look one up
          (read-only), fetch a QR code, list rates, query status.
          That&apos;s the entire set of operations a checkout actually
          needs. Nothing reachable from the internet can dump private
          keys, sign arbitrary transactions, or spend funds outside the
          lifecycle GRCpay itself controls.
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              The wallet daemon stays bound to localhost (or the internal
              Docker network) and is never reachable from outside.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              Only GRCpay&apos;s small REST surface is exposed publicly.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              Even if GRCpay&apos;s API is somehow compromised, the
              worst-case impact is the creation of empty payment wallets
              and the disclosure of already-public wallet state. None of
              the high-blast-radius wallet RPCs are reachable through it.
            </Typography>
          </li>
        </Box>
        <Typography gutterBottom variant="body1" component="p">
          This is the same model BTCPay uses for Bitcoin: the wallet stays
          private, and the payment processor only speaks the limited
          subset of commands a checkout actually needs.
        </Typography>

        <Typography variant="h5" component="h3" sx={{ pt: 3, pb: 1 }}>
          Sources
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body2">
              <code>DEFAULT_KEYPOOL_SIZE = 100</code>
              {' '}
              and the wallet&apos;s key-management internals:
              {' '}
              <NextMuiLink
                href="https://github.com/gridcoin-community/Gridcoin-Research/blob/master/src/wallet/wallet.h"
                color="primary"
              >
                src/wallet/wallet.h
              </NextMuiLink>
              {' '}
              on the
              {' '}
              <code>master</code>
              {' '}
              branch of
              {' '}
              <code>gridcoin-community/Gridcoin-Research</code>
              .
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              JSON-RPC commands referenced in this chapter (
              <code>getnewaddress</code>
              ,
              {' '}
              <code>keypoolrefill</code>
              ,
              {' '}
              <code>getreceivedbyaddress</code>
              ,
              {' '}
              <code>sendtoaddress</code>
              ,
              {' '}
              <code>listtransactions</code>
              ,
              {' '}
              <code>getrawtransaction</code>
              ):
              {' '}
              <NextMuiLink
                href="https://gridcoin.us/wiki/rpc.html"
                color="primary"
              >
                Gridcoin RPC commands wiki
              </NextMuiLink>
              .
            </Typography>
          </li>
        </Box>
      </Box>
    </Box>
  );
}
