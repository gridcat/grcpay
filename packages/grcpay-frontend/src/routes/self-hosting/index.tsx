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
  Prerequisites,
  QuickStart,
  FullStack,
  HotCold,
  Configuration,
  ReverseProxy,
  Verification,
  Operations,
} from './Chapters';

export function Page() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <>
      <Seo
        title={`${SITE_NAME} :: Self-hosting`}
        description="How to run GRCpay on your own infrastructure: connect to an existing Gridcoin wallet, or stand up the whole stack with Docker Compose. Configuration reference, reverse proxy snippets, verification, and day-to-day operations."
        path="/self-hosting"
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
                Self-hosting GRCpay
              </Typography>
              <Typography gutterBottom variant="body1" component="p" sx={{ pb: 2 }}>
                GRCpay is built to be run by the merchant who collects the
                payments — that&apos;s the canonical setup, not a fallback.
                Two paths are covered: connecting to a Gridcoin wallet you
                already operate, and standing up the whole stack from
                scratch with Docker Compose.
              </Typography>
              <Overview />
              <Prerequisites />
              <QuickStart />
              <FullStack />
              <HotCold />
              <Configuration />
              <ReverseProxy />
              <Verification />
              <Operations />
            </Grid>
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
