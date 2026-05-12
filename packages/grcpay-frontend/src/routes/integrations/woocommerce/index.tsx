import React from 'react';
import {
  Container,
  Typography,
} from '@mui/material';
import { Header } from '@/components/Header/Header';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { Seo, SITE_NAME, SITE_URL } from '@/components/Seo';
import { AUTHOR_GRIDCAT, breadcrumbList, PUBLISHER_ORG } from '@/lib/structuredData';
import { PageWrapper } from '@/components/PageWrapper';
import { Install, Configure, TestInstall } from './Chapters';

export function Page() {
  return (
    <>
      <Seo
        title={`${SITE_NAME} :: WooCommerce`}
        description="Install, configure and try the GRCpay WooCommerce plugin. Accept Gridcoin payments in your WordPress store with no code."
        path="/integrations/woocommerce"
        ogType="article"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'SoftwareApplication',
              name: 'GRCpay for WooCommerce',
              alternateName: 'Gridcoin Pay WooCommerce plugin',
              description: 'WordPress plugin that adds a Gridcoin payment method to any WooCommerce store. Customers see a QR code at checkout; merchants receive funds directly at their own wallet.',
              applicationCategory: 'BusinessApplication',
              applicationSubCategory: 'PaymentGateway',
              operatingSystem: 'WordPress',
              url: `${SITE_URL}/integrations/woocommerce`,
              softwareRequirements: 'WordPress, WooCommerce, GRCpay backend',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
              author: AUTHOR_GRIDCAT,
              publisher: PUBLISHER_ORG,
            },
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Integrations', path: '/integrations' },
              { name: 'WooCommerce', path: '/integrations/woocommerce' },
            ]),
          ],
        }}
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
            checkout, and you receive funds at your own wallet. No middleman,
            no custodial risk.
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
