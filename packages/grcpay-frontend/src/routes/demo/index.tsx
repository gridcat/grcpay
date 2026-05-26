import React, { useCallback, useEffect, useState } from 'react';
import {
  Container,
  Grid,
  Typography,
  Alert,
  AlertTitle,
} from '@mui/material';
import Link from 'next/link';
import { Header } from '@/components/Header/Header';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { Seo, SITE_NAME, SITE_HOST } from '@/components/Seo';
import { breadcrumbList } from '@/lib/structuredData';
import { PageWrapper } from '@/components/PageWrapper';
import { WalletEntity } from '@/entities/WalletEntity';
import { CreateWalletForm } from './CreateWalletForm';
import { WalletStatusPanel } from './WalletStatusPanel';

// Per-tab persistence for the demo wallet. The backend's one-time
// reveal of `token` happens on the POST /wallets response and is
// never re-emitted; without holding it client-side, a refresh would
// drop us back to the create form with the wallet still alive on the
// backend but unreadable from this browser. sessionStorage scopes the
// secret to the current tab — closing the tab clears it, which keeps
// the demo from leaking a token into a shared-laptop scenario.
const STORAGE_KEY = 'grcpay_demo_wallet';

function readStoredWallet(): WalletEntity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // The entity holds GRC numbers (already halford-converted at
    // creation time), so we just re-attach the prototype rather than
    // running the constructor (which would re-divide by HALFORD).
    return Object.assign(Object.create(WalletEntity.prototype), JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredWallet(w: WalletEntity | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (w) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(w));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (private mode quota, sandboxed
    // iframe). Demo still works in-memory; refresh resets it.
  }
}

export function Page() {
  // Start null on every render so the SSR markup matches the first
  // client paint; hydrate from sessionStorage in an effect.
  const [wallet, setWallet] = useState<WalletEntity | null>(null);

  useEffect(() => {
    const stored = readStoredWallet();
    if (stored) setWallet(stored);
  }, []);

  const handleCreated = useCallback((w: WalletEntity) => {
    writeStoredWallet(w);
    setWallet(w);
  }, []);

  const handlePersist = useCallback((w: WalletEntity) => {
    writeStoredWallet(w);
    setWallet(w);
  }, []);

  const handleReset = useCallback(() => {
    writeStoredWallet(null);
    setWallet(null);
  }, []);

  return (
    <>
      <Seo
        title={`${SITE_NAME} :: Demo`}
        description="Try GRCpay live: create a payment wallet against the running backend and watch its lifecycle in real time."
        path="/demo"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Demo', path: '/demo' },
            ]),
          ],
        }}
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="md" sx={{ flexGrow: 1, py: 4 }}>
          <GradientLine />
          <Typography component="h1" variant="h4" sx={{ pb: 2 }}>
            Live demo
          </Typography>
          <Typography gutterBottom variant="body1" component="p" sx={{ pb: 2 }}>
            Mint a real payment wallet against the running GRCpay backend, view
            the QR code, and watch the lifecycle update as the backend polls
            the chain. No actual GRC is moved unless you transfer it yourself.
          </Typography>
          <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
            <AlertTitle>You&apos;re using the public instance</AlertTitle>
            This page hits the public
            {' '}
            <code>{SITE_HOST}</code>
            {' '}
            install. It&apos;s free for now: no SLA, no warranty (see the
            {' '}
            <Link href="/disclaimer#public-instance" style={{ color: 'inherit' }}>disclaimer</Link>
            ). For production we strongly recommend
            {' '}
            <Link href="/about#hosting" style={{ color: 'inherit' }}>running your own instance</Link>
            {' '}
            against your own Gridcoin wallet.
          </Alert>
          {wallet && (
            <Alert severity="success" variant="outlined" sx={{ mb: 3 }}>
              Your demo wallet is saved for this tab, so refresh is safe.
              Closing the tab clears it and you lose the access token (the
              wallet still settles on its own, you just can&apos;t view or
              cancel it from this browser anymore).
            </Alert>
          )}
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              {wallet ? (
                <WalletStatusPanel
                  initialWallet={wallet}
                  onPersist={handlePersist}
                  onReset={handleReset}
                />
              ) : (
                <CreateWalletForm onCreated={handleCreated} />
              )}
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
