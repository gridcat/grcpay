import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useInterval } from '@/hooks';
import { WalletsRepository } from '@/repositories/WalletsRepository';
import { WalletEntity, WalletStatus, formatGrc } from '@/entities/WalletEntity';

interface Props {
  initialWallet: WalletEntity;
  onReset: () => void;
}

const STATUS_COLOR: Record<WalletStatus, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  new: 'default',
  confirming: 'info',
  funded: 'primary',
  processed: 'success',
  refunded: 'success',
  expired: 'warning',
  norefund: 'warning',
  error: 'error',
};

export function WalletStatusPanel({ initialWallet, onReset }: Props) {
  const [wallet, setWallet] = useState<WalletEntity>(initialWallet);
  // Poll while the wallet is still in flight — `new` OR `confirming`
  // (the latter means we saw enough funds at 0-conf, but they still
  // need to confirm before the wallet settles).
  const [polling, setPolling] = useState<boolean>(
    initialWallet.status === 'new' || initialWallet.status === 'confirming',
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const repo = React.useMemo(() => new WalletsRepository(), []);

  // Fetch the QR data URL once on mount. The /qr endpoint returns JSON:API
  // with a `qr` attribute that already contains a data:image/png;base64,...
  // string — we just stash it in state and feed it to <img>.
  useEffect(() => {
    let cancelled = false;
    repo.getQrDataUrl(wallet.address)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        // Leave qrDataUrl null; the UI shows a placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, [repo, wallet.address]);

  // Stop polling only when the wallet reaches a settled state.
  // `new` and `confirming` both still need observation — `confirming`
  // is the "we see it on-chain, waiting for the confs to tick up"
  // state, which the backend transitions out of on its own.
  useEffect(() => {
    if (wallet.status !== 'new' && wallet.status !== 'confirming') {
      setPolling(false);
    }
  }, [wallet.status]);

  useInterval(async () => {
    // Reads are auth-gated; replay the one-time creation token on
    // each poll. No token means the demo was reloaded mid-flow and
    // we can't read the wallet back.
    if (!wallet.token) {
      setPolling(false);
      return;
    }
    try {
      const latest = await repo.getWallet(wallet.address, wallet.token);
      if (!latest) return;
      // Skip the setState if nothing observable changed — avoids a
      // full re-render every 4s when the wallet is idle.
      if (
        latest.status === wallet.status
        && latest.amountReceived === wallet.amountReceived
        && latest.amountPending === wallet.amountPending
        && latest.refundTx === wallet.refundTx
        && latest.refundAmount === wallet.refundAmount
      ) {
        return;
      }
      setWallet(latest);
    } catch {
      // Transient — keep polling; backend should recover next tick.
    }
  }, polling ? 4000 : null);

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        backgroundColor: 'background.paper',
      }}
    >
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            Payment wallet
          </Typography>
          <Chip
            label={wallet.status}
            color={STATUS_COLOR[wallet.status]}
            sx={{ fontFamily: 'monospace', fontWeight: 700 }}
          />
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          {qrDataUrl ? (
            // The backend renders the PNG and returns it as a base64 data URL
            // inside a JSON:API envelope, so we feed it straight to <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`QR code for ${wallet.address}`}
              width={256}
              height={256}
              style={{ borderRadius: 8 }}
            />
          ) : (
            <Box
              sx={{
                width: 256,
                height: 256,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                color: 'text.secondary',
                fontSize: 12,
              }}
            >
              Loading QR…
            </Box>
          )}
        </Box>

        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Address
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
          >
            {wallet.address}
          </Typography>
        </Box>

        {wallet.recipient && (
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Recipient
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
            >
              {wallet.recipient}
            </Typography>
          </Box>
        )}

        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {`Received ${formatGrc(wallet.amountReceived)} / ${formatGrc(wallet.amountRequired)} GRC`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={wallet.progressFraction * 100}
            sx={{ mt: 0.5, height: 8, borderRadius: 1 }}
          />
        </Box>

        {wallet.status === 'confirming' && (
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.12)' : 'rgba(33, 150, 243, 0.14)'),
              borderLeft: '4px solid',
              borderLeftColor: 'info.main',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Payment detected, waiting for confirmations
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Your full payment has arrived at the network level. GRCpay is
              waiting for a few more blocks before marking the wallet as
              funded. This usually takes a couple of minutes. You can safely
              close this page; the wallet status will update on its own.
            </Typography>
          </Box>
        )}

        {wallet.status === 'new' && wallet.amountPending > 0 && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.12)'),
              borderLeft: '3px solid',
              borderLeftColor: 'info.main',
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              Waiting for confirmations
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {`${formatGrc(wallet.amountPending)} GRC`}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
              Detected on chain, not yet confirmed. GRCpay will settle it once it reaches the configured block depth.
            </Typography>
          </Box>
        )}

        {wallet.status === 'new' && wallet.amountReceived > 0 && wallet.amountRemaining > 0 && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(255, 193, 7, 0.08)' : 'rgba(255, 193, 7, 0.14)'),
              borderLeft: '3px solid',
              borderLeftColor: 'warning.main',
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              Still owed
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {`${formatGrc(wallet.amountRemaining)} GRC`}
            </Typography>
          </Box>
        )}

        {wallet.refundAmount !== null && wallet.refundAmount > 0 && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              backgroundColor: (t) => (t.palette.mode === 'dark' ? 'rgba(76, 175, 80, 0.08)' : 'rgba(76, 175, 80, 0.12)'),
              borderLeft: '3px solid',
              borderLeftColor: 'success.main',
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              Overpayment refunded
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {`${formatGrc(wallet.refundAmount)} GRC`}
              {wallet.refundTx && (
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ ml: 1, fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}
                >
                  {`(tx ${wallet.refundTx.slice(0, 12)}…)`}
                </Typography>
              )}
            </Typography>
          </Box>
        )}

        {polling && (
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            Polling the backend every 4s. Stops once the wallet is funded or expires.
          </Typography>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {wallet.status === 'new' && wallet.token && (
            <Button
              variant="outlined"
              color="warning"
              onClick={async () => {
                const { token } = wallet;
                if (!token) return;
                try {
                  await repo.cancelWallet(wallet.address, token);
                  setPolling(false);
                  // Clone the entity and flip just the status so
                  // React sees a new reference without the
                  // halford→GRC→halford round trip through a fake
                  // raw-data shape.
                  const cancelled = Object.assign(
                    Object.create(WalletEntity.prototype),
                    wallet,
                    { status: 'expired' as WalletStatus },
                  );
                  setWallet(cancelled);
                } catch {
                  // Next poll will show the real state anyway.
                }
              }}
            >
              Cancel wallet
            </Button>
          )}
          <Button variant="outlined" onClick={onReset}>
            Create another wallet
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
