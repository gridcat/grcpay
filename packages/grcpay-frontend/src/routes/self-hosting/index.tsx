import React from 'react';
import {
  Container,
  useMediaQuery,
  useTheme,
  Grid,
  Typography,
} from '@mui/material';
import { Header } from '@/components/Header/Header';
import { Seo, SITE_NAME, SITE_URL } from '@/components/Seo';
import { AUTHOR_GRIDCAT, breadcrumbList, PUBLISHER_ORG } from '@/lib/structuredData';
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
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'TechArticle',
              headline: `Self-hosting ${SITE_NAME}`,
              description: 'How to run GRCpay on your own infrastructure with Docker Compose, configuration reference, reverse-proxy snippets, and operations.',
              mainEntityOfPage: `${SITE_URL}/self-hosting`,
              author: AUTHOR_GRIDCAT,
              publisher: PUBLISHER_ORG,
              articleSection: 'Operations',
              proficiencyLevel: 'Expert',
            },
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Self-hosting', path: '/self-hosting' },
            ]),
          ],
        }}
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
                payments. That&apos;s the canonical setup, not a fallback.
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
