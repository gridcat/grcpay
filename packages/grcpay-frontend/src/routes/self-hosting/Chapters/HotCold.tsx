import {
  Typography,
  Box,
  Alert,
} from '@mui/material';
import React from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function HotCold() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="hot-cold" sx={{ pb: 2 }}>
        Hot/cold wallet pattern (recommended)
      </Typography>
      <Box component="article">
        <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
          <b>This is the recommended production posture.</b>
          {' '}
          Even when self-hosting, give GRCpay its own dedicated &ldquo;hot&rdquo;
          wallet and forward every payment onward to a separate wallet you
          control. The hot wallet is the only one GRCpay can touch.
        </Alert>

        <Typography gutterBottom variant="body1" component="p">
          The earlier sections show GRCpay pointed at a single wallet,
          which is the simplest setup and fine for trial runs. For a real
          production deployment, split the wallet in two:
        </Typography>
        <Box component="ul" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              The
              {' '}
              <b>hot wallet</b>
              {' '}
              is what GRCpay talks to. Its only job is to mint payment
              addresses and briefly hold in-flight customer funds before
              forwarding them on. It runs on the same host as GRCpay, in
              the same Docker network, and never holds a meaningful
              balance.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              The
              {' '}
              <b>cold wallet</b>
              {' '}
              (or main merchant wallet) is where the money actually lives.
              It can be on a different host, an air-gapped machine, or a
              hardware wallet — whatever your operational comfort allows.
              GRCpay never has its private keys and never makes RPC calls
              to it.
            </Typography>
          </li>
        </Box>

        <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
          Why this matters
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          GRCpay&apos;s public REST surface is deliberately narrow, but
          the worst-case scenario for any internet-facing service is a
          full host compromise — a kernel exploit, a supply-chain attack
          on a dependency, a misconfigured SSH key, anything. If that
          happens, the attacker gets shell access to the box GRCpay runs
          on, and from there, full access to whatever wallet GRCpay is
          pointed at.
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          With a single-wallet setup, that&apos;s every GRC you&apos;ve
          ever earned. With the hot/cold split, the attacker drains the
          hot wallet and walks away with only whatever happened to be
          mid-settlement at that moment — typically zero or a single
          order&apos;s worth of GRC. The blast radius shrinks from
          &ldquo;everything&rdquo; to &ldquo;maybe a few minutes of
          revenue.&rdquo;
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          This is the same pattern Bitcoin merchants use behind BTCPay,
          and it&apos;s the right default for any production payment
          processor.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          How to set it up
        </Typography>
        <Box component="ol" sx={{ pl: 4, mt: 0, mb: 2 }}>
          <li>
            <Typography variant="body1">
              Run a
              {' '}
              <b>second wallet daemon</b>
              {' '}
              dedicated to GRCpay. In the Docker Compose example from the
              previous section, the
              {' '}
              <code>wallet</code>
              {' '}
              service
              <i> is </i>
              the hot wallet — that&apos;s already correct. The thing
              that changes is what you do with the money once it arrives.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              Generate a fresh address in your
              {' '}
              <b>cold wallet</b>
              {' '}
              (the merchant wallet you actually want the money to land
              in). Save it somewhere your checkout integration can read
              it — a config value, an environment variable, a database
              row, whatever fits.
            </Typography>
          </li>
          <li>
            <Typography variant="body1">
              In your checkout integration (or the WooCommerce plugin,
              once it ships), set the
              {' '}
              <code>recipient</code>
              {' '}
              field on every
              {' '}
              <code>POST /wallets</code>
              {' '}
              call to that cold-wallet address:
            </Typography>
          </li>
        </Box>
        <CodeBlock
          caption="POST /api/wallets"
          language="json"
          code={`{
  "data": {
    "type": "wallets",
    "attributes": {
      "amountRequired": 12.5,
      "recipient": "SCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  }
}`}
        />
        <Typography gutterBottom variant="body1" component="p">
          That&apos;s it. GRCpay generates a one-shot address from the
          hot wallet, the customer pays it, the job loop sees the
          incoming funds within ~10 seconds, and the
          {' '}
          <code>walletFundedProcessor</code>
          {' '}
          immediately forwards the balance (minus the
          {' '}
          <code>0.001 GRC</code>
          {' '}
          network fee) to the cold address. The wallet record transitions
          {' '}
          <code>new → funded → processed</code>
          , the
          {' '}
          <code>tx_out</code>
          {' '}
          column gets the forwarding txid, and the hot wallet is back to
          zero.
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          What the hot wallet&apos;s balance should look like
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          On a healthy production deployment, plotting the hot
          wallet&apos;s balance over time should look like a sawtooth:
          near-zero baseline, brief spikes when customers pay, dropping
          straight back down within seconds. If you ever see the
          baseline drift upward — funds accumulating that aren&apos;t
          being forwarded — that&apos;s a signal something is wrong:
          the cold address is invalid, the forwarding flow hit an error,
          or you&apos;ve got wallets stuck in
          {' '}
          <code>error</code>
          {' '}
          state. Check the
          {' '}
          <code>db_logs</code>
          {' '}
          table or the container logs.
        </Typography>

        <Alert severity="info" variant="outlined" sx={{ my: 2 }}>
          The hot wallet does need
          <i> some </i>
          GRC of its own — just enough to pay the network fee on each
          forward leg (
          <code>0.001 GRC</code>
          {' '}
          per transaction by default). A few GRC is plenty for
          months of operation. Top it up the same way you&apos;d fund
          any other wallet.
        </Alert>
      </Box>
    </Box>
  );
}
