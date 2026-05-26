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
  Conventions,
  Status,
  Wallets,
  Webhooks,
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
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'TechArticle',
              headline: `${SITE_NAME} API Reference`,
              description: 'Reference for the GRCpay REST API: create payment wallets, look up status, fetch QR codes, and convert fiat amounts.',
              mainEntityOfPage: `${SITE_URL}/developers`,
              author: AUTHOR_GRIDCAT,
              publisher: PUBLISHER_ORG,
              articleSection: 'API Documentation',
              proficiencyLevel: 'Expert',
            },
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'API', path: '/developers' },
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
                API reference
              </Typography>
              <Typography gutterBottom variant="body1" component="p">
                Reference for integrating GRCpay from your backend or ecommerce
                platform.
              </Typography>
              <Overview />
              <Conventions />
              <Status />
              <Wallets />
              <Webhooks />
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
