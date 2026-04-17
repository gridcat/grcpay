import React from 'react';
import {
  Container,
  Typography,
} from '@mui/material';
import { Header } from '@/components/Header/Header';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { Seo, SITE_NAME } from '@/components/Seo';
import { PageWrapper } from '@/components/PageWrapper';
import { Install, Configure, TestInstall } from './Chapters';

export function Page() {
  return (
    <>
      <Seo
        title={`${SITE_NAME} :: WooCommerce`}
        description="Install, configure and try the GRCpay WooCommerce plugin — accept Gridcoin payments in your WordPress store with no code."
        path="/integrations/woocommerce"
        ogType="article"
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="md" sx={{ flexGrow: 1, py: 4 }}>
          <GradientLine />
          <Typography component="h1" variant="h4" sx={{ pb: 2 }}>
            GRCpay for WooCommerce
          </Typography>
          <Typography gutterBottom variant="body1" component="p" sx={{ pb: 2 }}>
            The GRCpay WooCommerce plugin adds a Gridcoin payment method to any
            WordPress store running WooCommerce. Customers see a QR code at
            checkout, you receive funds at your wallet — no middleman, no
            custodial risk.
          </Typography>
          <Install />
          <Configure />
          <TestInstall />
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
