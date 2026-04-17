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
  WhyGrcpay,
  Protocol,
  Settlement,
  Refunds,
  Expiry,
  Hosting,
  Privacy,
} from './Chapters';

export function Page() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <>
      <Seo
        title={`${SITE_NAME} :: About`}
        description="Learn how GRCpay mints one-shot Gridcoin payment wallets, settles funds to merchants, and handles refunds and expiry."
        path="/about"
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
                {`About ${SITE_NAME}`}
              </Typography>
              <Typography gutterBottom variant="body1" component="p">
                GRCpay is a small, self-hosted service that turns the Gridcoin
                blockchain into a checkout settlement layer. This page walks
                through how it works end-to-end.
              </Typography>
              <Overview />
              <WhyGrcpay />
              <Protocol />
              <Settlement />
              <Refunds />
              <Expiry />
              <Hosting />
              <Privacy />
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
