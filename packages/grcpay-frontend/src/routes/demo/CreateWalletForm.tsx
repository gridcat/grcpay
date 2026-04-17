import React, { useState } from 'react';
import {
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import { WalletsRepository } from '@/repositories/WalletsRepository';
import { WalletEntity } from '@/entities/WalletEntity';

interface Props {
  onCreated: (wallet: WalletEntity) => void;
}

export function CreateWalletForm({ onCreated }: Props) {
  const [amount, setAmount] = useState('0.01');
  const [recipient, setRecipient] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Amount must be a positive number.');
      return;
    }
    setSubmitting(true);
    try {
      const repo = new WalletsRepository();
      const wallet = await repo.createWallet({
        amountRequired: parsed,
        ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
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

  return (
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
        real GRC will be charged unless you actually transfer it.
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
  );
}
