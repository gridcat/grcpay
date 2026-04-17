import React from 'react';
import {
  Container,
  useMediaQuery,
  useTheme,
  Grid,
  Typography,
} from '@mui/material';
import { Header } from '@/components/Header/Header';
import { Seo, SITE_NAME } from '@/components/Seo';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { PageWrapper } from '@/components/PageWrapper';
import { Contents } from './Contents';
import {
  Overview,
  Conventions,
  Status,
  Wallets,
  FeeMath,
  Qr,
  Rates,
  Errors,
} from './Chapters';

export function Page() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <>
      <Seo
        title={`${SITE_NAME} :: API`}
        description="Reference for the GRCpay REST API: create payment wallets, look up status, fetch QR codes, and convert fiat amounts via the rates endpoint."
        path="/developers"
        ogType="article"
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="xl" sx={{ flexGrow: 1 }}>
          <GradientLine />
          <Grid container spacing={3}>
            <Grid size={{ sm: 3, xs: 12 }} sx={{ display: isMobile ? 'none' : 'flex' }}>
              <Contents />
            </Grid>
            <Grid size={{ sm: 9, xs: 12 }}>
              <Typography component="h1" variant="h4" sx={{ pb: 2 }}>
                API reference
              </Typography>
              <Typography gutterBottom variant="body1" component="p">
                Everything you need to integrate GRCpay from your own backend or
                ecommerce platform.
              </Typography>
              <Overview />
              <Conventions />
              <Status />
              <Wallets />
              <FeeMath />
              <Qr />
              <Rates />
              <Errors />
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
