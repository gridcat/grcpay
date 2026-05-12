import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import { WalletsRepository } from '@/repositories/WalletsRepository';
import { WalletEntity } from '@/entities/WalletEntity';
import { SITE_HOST } from '@/components/Seo';

interface Props {
  onCreated: (wallet: WalletEntity) => void;
}

export function CreateWalletForm({ onCreated }: Props) {
  const [amount, setAmount] = useState('0.01');
  const [recipient, setRecipient] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donationConfirmOpen, setDonationConfirmOpen] = useState(false);

  const trimmedRecipient = recipient.trim();
  const isDonation = trimmedRecipient.length === 0;

  const validateAmount = (): number | null => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Amount must be a positive number.');
      return null;
    }
    return parsed;
  };

  const submitWallet = async (parsedAmount: number) => {
    setSubmitting(true);
    try {
      const repo = new WalletsRepository();
      const wallet = await repo.createWallet({
        amountRequired: parsedAmount,
        ...(trimmedRecipient ? { recipient: trimmedRecipient } : {}),
      });
      if (!wallet) {
        setError('The API returned an empty response. Check the backend logs.');
        return;
      }
      onCreated(wallet);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to create wallet: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = validateAmount();
    if (parsed === null) return;

    if (isDonation) {
      setDonationConfirmOpen(true);
      return;
    }

    submitWallet(parsed);
  };

  const handleConfirmDonation = () => {
    setDonationConfirmOpen(false);
    const parsed = validateAmount();
    if (parsed === null) return;
    submitWallet(parsed);
  };

  return (
    <>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          p: { xs: 2, md: 3 },
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          backgroundColor: 'background.paper',
        }}
      >
        <Typography variant="h6" component="h2" sx={{ pb: 1 }}>
          Create a payment wallet
        </Typography>
        <Typography variant="body2" sx={{ pb: 2, color: 'text.secondary' }}>
          Fill in an amount in GRC and (optionally) a recipient address. The
          backend will mint a fresh Gridcoin address you can send funds to. No
          real GRC moves unless you actually transfer it.
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Amount required (GRC)"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            slotProps={{ htmlInput: { step: '0.01', min: '0' } }}
            required
            fullWidth
          />
          <TextField
            label="Recipient address (optional)"
            placeholder="SHpqN8xEjy2HHTnAGfgJjwFThuqzLbBs6i"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            fullWidth
          />
          {isDonation && (
            <Alert
              severity="warning"
              variant="filled"
              icon={<VolunteerActivismIcon />}
            >
              <AlertTitle sx={{ fontWeight: 700 }}>
                No recipient = donation to the operator
              </AlertTitle>
              You haven&apos;t entered a recipient address. Any GRC you send
              to the wallet that gets minted will land in the
              public-instance operator&apos;s wallet, and will
              {' '}
              <strong>not be forwarded or refunded</strong>
              . If you don&apos;t mean to donate, paste an address you
              control above.
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create wallet'}
          </Button>
        </Stack>
      </Box>

      <Dialog
        open={donationConfirmOpen}
        onClose={() => setDonationConfirmOpen(false)}
        aria-labelledby="donation-confirm-title"
        aria-describedby="donation-confirm-description"
      >
        <DialogTitle id="donation-confirm-title">
          Send without a recipient?
        </DialogTitle>
        <DialogContent>
          <DialogContentText
            id="donation-confirm-description"
            component="div"
          >
            <Typography gutterBottom>
              You&apos;re about to create a payment wallet on the public
              {' '}
              <code>{SITE_HOST}</code>
              {' '}
              instance with
              {' '}
              <strong>no recipient address</strong>
              .
            </Typography>
            <Typography gutterBottom>
              If you actually send GRC to the address that gets minted, those
              funds will land in the Gridcoin wallet operated by us. They
              will
              {' '}
              <strong>not be forwarded anywhere</strong>
              {' '}
              and they
              {' '}
              <strong>will not be refunded</strong>
              . On-chain transactions are final, and without a recipient
              there&apos;s nowhere for the backend to forward them to. In
              effect, this is a donation to the public-instance operator.
            </Typography>
            <Typography>
              If that&apos;s not what you intended, cancel and paste a
              Gridcoin address you control into the recipient field.
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDonationConfirmOpen(false)}
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDonation}
            variant="contained"
            color="warning"
            autoFocus
          >
            Yes, donate to the operator
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
