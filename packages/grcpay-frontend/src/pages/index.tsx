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
import { Seo, SITE_NAME, SITE_URL } from '@/components/Seo';
import { PageWrapper } from '@/components/PageWrapper';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { withThemeDataServerSide } from '@/lib/modeDataServer';
import {
  AUTHOR_GRIDCAT, faqPage, ORG_ID, PUBLISHER_ORG, type FaqEntry,
} from '@/lib/structuredData';

export const getServerSideProps = withThemeDataServerSide(
  async (_context: GetServerSidePropsContext) => ({
    props: {},
  }),
);

const faqs: FaqEntry[] = [
  {
    question: 'What is GRCpay?',
    answer: 'GRCpay is a self-hosted, non-custodial Gridcoin payment processor for merchants. It mints a fresh Gridcoin address for every order, watches the blockchain for incoming funds, and forwards the payment to the merchant’s wallet. No custodian sits in the middle.',
  },
  {
    question: 'How do I accept Gridcoin payments on my site?',
    answer: 'Run GRCpay next to a Gridcoin wallet daemon and call POST /wallets from your checkout with the amount you expect. GRCpay returns a fresh address and QR code, the customer pays it directly, and once the funds confirm on chain GRCpay forwards them to your merchant wallet and marks the order processed.',
  },
  {
    question: 'Is GRCpay custodial?',
    answer: 'No. Funds flow directly from buyer to merchant on the Gridcoin blockchain. GRCpay only handles address minting, lifecycle tracking, and forwarding. It never holds customer funds in a pooled account.',
  },
  {
    question: 'Does GRCpay support WooCommerce?',
    answer: 'A WooCommerce plugin is in beta testing. It adds a Gridcoin payment method to any WordPress store: customers see a QR code at checkout, merchants receive funds at their own wallet. Public release is coming soon.',
  },
  {
    question: 'Can I self-host GRCpay?',
    answer: 'Self-hosting is the canonical setup, not a fallback. The repository ships with a Docker Compose stack that runs GRCpay alongside a Gridcoin wallet, and the docs cover both connecting to an existing wallet and standing the whole stack up from scratch.',
  },
  {
    question: 'What happens if a customer underpays or pays after the order expires?',
    answer: 'If a wallet expires with funds still on it, GRCpay walks the transaction history with listtransactions / getrawtransaction and refunds the sender automatically. If it can’t figure out a sender, the wallet is parked in an error state for manual review.',
  },
];

const features: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: 'How it works',
    body: 'The protocol, the wallet lifecycle, and what happens to refunds when an order expires unpaid.',
    href: '/about',
    cta: 'Learn more →',
  },
  {
    title: 'API',
    body: 'A small REST API: mint wallets, look them up, fetch QR codes. Responses are JSON:API documents.',
    href: '/developers',
    cta: 'Read the API docs →',
  },
  {
    title: 'Ecommerce plugins',
    body: 'WooCommerce plugin is in beta testing. Shopify, Magento and PrestaShop are on the roadmap.',
    href: '/integrations',
    cta: 'See plugins →',
  },
];

export default function Home() {
  return (
    <>
      <Seo
        title={`${SITE_NAME}: Gridcoin payment processor for merchants`}
        description="Accept Gridcoin payments in any checkout. GRCpay is a self-hosted, non-custodial Gridcoin payment processor for merchants. It mints a fresh wallet per order, watches the chain, and forwards funds to your wallet."
        path="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebSite',
              '@id': `${SITE_URL}/#website`,
              name: SITE_NAME,
              alternateName: 'GRCpay',
              url: SITE_URL,
              description: 'Self-hosted, non-custodial Gridcoin payment processor for merchants.',
              inLanguage: 'en',
              publisher: { '@id': ORG_ID },
            },
            PUBLISHER_ORG,
            {
              '@type': 'SoftwareApplication',
              name: SITE_NAME,
              applicationCategory: 'FinanceApplication',
              applicationSubCategory: 'PaymentGateway',
              operatingSystem: 'Linux, macOS, Windows (Docker)',
              url: SITE_URL,
              description: 'Self-hosted, non-custodial Gridcoin payment processor for merchants. Accepts Gridcoin (GRC) payments at checkout. Mints a fresh address per order, watches the blockchain, forwards funds to the merchant.',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
              author: AUTHOR_GRIDCAT,
              publisher: { '@id': ORG_ID },
            },
            faqPage(faqs),
          ],
        }}
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
              {`${SITE_NAME} mints a fresh Gridcoin address for every order, watches the blockchain for incoming funds, and forwards the payment to your wallet. Self-hosted, open source, non-custodial.`}
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

          <Box component="section" sx={{ py: { xs: 4, md: 6 }, maxWidth: 820, mx: 'auto' }}>
            <Typography component="h2" variant="h4" sx={{ fontWeight: 700, pb: 3 }}>
              Frequently asked questions
            </Typography>
            {faqs.map((f) => (
              <Box key={f.question} sx={{ pb: 3 }}>
                <Typography component="h3" variant="h6" sx={{ fontWeight: 600, pb: 1 }}>
                  {f.question}
                </Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                  {f.answer}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
        <Footer />
      </PageWrapper>
      <ScrollTopFab />
    </>
  );
}
