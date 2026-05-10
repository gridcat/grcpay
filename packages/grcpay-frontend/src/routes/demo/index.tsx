import React, { useState } from 'react';
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
import { Seo, SITE_NAME } from '@/components/Seo';
import { breadcrumbList } from '@/lib/structuredData';
import { PageWrapper } from '@/components/PageWrapper';
import { WalletEntity } from '@/entities/WalletEntity';
import { CreateWalletForm } from './CreateWalletForm';
import { WalletStatusPanel } from './WalletStatusPanel';

export function Page() {
  const [wallet, setWallet] = useState<WalletEntity | null>(null);

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
            <code>grcpay.gridcoin.club</code>
            {' '}
            install. It&apos;s free for now, no SLA, no warranty (see the
            {' '}
            <Link href="/disclaimer#public-instance" style={{ color: 'inherit' }}>disclaimer</Link>
            ). For production we strongly recommend
            {' '}
            <Link href="/about#hosting" style={{ color: 'inherit' }}>running your own instance</Link>
            {' '}
            against your own Gridcoin wallet.
          </Alert>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              {wallet ? (
                <WalletStatusPanel
                  initialWallet={wallet}
                  onReset={() => setWallet(null)}
                />
              ) : (
                <CreateWalletForm onCreated={setWallet} />
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
