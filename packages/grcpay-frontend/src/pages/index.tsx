import React from 'react';
import type { GetServerSidePropsContext } from 'next';
import {
  Container,
  Grid,
  Typography,
  Box,
  Button,
  Card,
  CardContent,
  CardActionArea,
} from '@mui/material';
import Link from 'next/link';
import { Header } from '@/components/Header/Header';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { Seo, SITE_NAME } from '@/components/Seo';
import { PageWrapper } from '@/components/PageWrapper';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { withThemeDataServerSide } from '@/lib/modeDataServer';

export const getServerSideProps = withThemeDataServerSide(
  async (_context: GetServerSidePropsContext) => ({
    props: {},
  }),
);

const features: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: 'How it works',
    body: 'Read the protocol, lifecycle, and refund flow that GRCpay uses to settle Gridcoin payments end-to-end.',
    href: '/about',
    cta: 'Learn more →',
  },
  {
    title: 'API',
    body: 'A small REST API. Mint wallets, look them up, fetch QR codes — all returned as JSON:API documents.',
    href: '/developers',
    cta: 'Read the API docs →',
  },
  {
    title: 'Ecommerce plugins',
    body: 'Drop-in integrations for WooCommerce (live), Shopify, Magento and PrestaShop are on the roadmap.',
    href: '/integrations',
    cta: 'See plugins →',
  },
];

export default function Home() {
  return (
    <>
      <Seo
        title={`${SITE_NAME} — accept Gridcoin in your checkout`}
        description="GRCpay is a self-hosted Gridcoin payment facilitator. It mints one-shot wallets, monitors the chain, and forwards funds to merchants — no custodial risk, no middleman."
        path="/"
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="lg" sx={{ flexGrow: 1, py: { xs: 4, md: 6 } }}>
          <GradientLine />
          <Box sx={{ textAlign: { xs: 'left', md: 'center' }, py: { xs: 4, md: 6 } }}>
            <Typography
              component="h1"
              variant="h3"
              sx={{ fontWeight: 800, pb: 2 }}
            >
              Accept Gridcoin in any checkout.
            </Typography>
            <Typography
              variant="h6"
              component="p"
              sx={{ color: 'text.secondary', pb: 4, maxWidth: 720, mx: 'auto' }}
            >
              {`${SITE_NAME} mints a fresh Gridcoin address for every order, watches the blockchain for incoming funds, and forwards the payment straight to your wallet. Self-hosted, privacy-first, open source.`}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button
                component={Link}
                href="/demo"
                variant="contained"
                color="primary"
                size="large"
              >
                Try the demo
              </Button>
              <Button
                component={Link}
                href="/developers"
                variant="outlined"
                color="primary"
                size="large"
              >
                Read the docs
              </Button>
            </Box>
          </Box>

          <Grid container spacing={3} sx={{ pb: 4 }}>
            {features.map((f) => (
              <Grid key={f.href} size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardActionArea component={Link} href={f.href} sx={{ height: '100%' }}>
                    <CardContent>
                      <Typography variant="h6" component="h2">
                        {f.title}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary', pt: 1, pb: 2 }}>
                        {f.body}
                      </Typography>
                      <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                        {f.cta}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
