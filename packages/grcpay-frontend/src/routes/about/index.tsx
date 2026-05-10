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
        description="GRCpay mints one-shot Gridcoin payment wallets, settles funds to merchants, and handles refunds and expiry."
        path="/about"
        ogType="article"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Article',
              headline: `About ${SITE_NAME}`,
              description: 'How GRCpay turns the Gridcoin blockchain into a checkout settlement layer.',
              mainEntityOfPage: `${SITE_URL}/about`,
              author: AUTHOR_GRIDCAT,
              publisher: PUBLISHER_ORG,
            },
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'About', path: '/about' },
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
                {`About ${SITE_NAME}`}
              </Typography>
              <Typography gutterBottom variant="body1" component="p">
                GRCpay is a small, self-hosted service that turns the Gridcoin
                blockchain into a checkout settlement layer. This page walks
                through how it works.
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
