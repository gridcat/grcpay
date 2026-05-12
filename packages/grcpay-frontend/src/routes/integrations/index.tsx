import React from 'react';
import {
  Container,
  Grid,
  Typography,
} from '@mui/material';
import { Header } from '@/components/Header/Header';
import { Footer } from '@/components/Footer/Footer';
import { GradientLine } from '@/components/GradientLine';
import { ScrollTopFab } from '@/components/ScrollTopFab/ScrollTopFab';
import { Seo, SITE_NAME, SITE_URL } from '@/components/Seo';
import { breadcrumbList } from '@/lib/structuredData';
import { PageWrapper } from '@/components/PageWrapper';
import { WooCommerceCard } from './Cards/WooCommerceCard';
import { ComingSoonCard } from './Cards/ComingSoonCard';

const comingSoon: { name: string; description: string }[] = [
  {
    name: 'Shopify',
    description:
      'Storefront app for Shopify merchants. Same checkout flow as the WooCommerce plugin, same on-chain settlement.',
  },
  {
    name: 'Magento',
    description:
      'Adobe Commerce module. Drop-in payment method that talks to a self-hosted GRCpay instance.',
  },
  {
    name: 'PrestaShop',
    description:
      'PrestaShop module mirroring the WooCommerce plugin: install it, point at your GRCpay URL, you\u2019re live.',
  },
];

export function Page() {
  return (
    <>
      <Seo
        title={`${SITE_NAME} :: Integrations`}
        description="Ecommerce plugins and integrations that wrap the GRCpay API for popular checkout platforms."
        path="/integrations"
        jsonLd={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'CollectionPage',
              name: `${SITE_NAME} integrations`,
              description: 'Ecommerce plugins that wrap the GRCpay API for WooCommerce and other checkout platforms.',
              url: `${SITE_URL}/integrations`,
              isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
            },
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Integrations', path: '/integrations' },
            ]),
          ],
        }}
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="lg" sx={{ flexGrow: 1, py: 4 }}>
          <GradientLine />
          <Typography component="h1" variant="h4" sx={{ pb: 2 }}>
            Integrations
          </Typography>
          <Typography gutterBottom variant="body1" component="p" sx={{ pb: 3 }}>
            GRCpay is building first-party plugins for popular ecommerce
            platforms. Each one wraps the API so merchants can accept Gridcoin
            payments without writing any code. The WooCommerce plugin is in
            beta testing right now; everything else below is on the roadmap.
          </Typography>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <WooCommerceCard />
            </Grid>
            {comingSoon.map((p) => (
              <Grid key={p.name} size={{ xs: 12, md: 6 }}>
                <ComingSoonCard name={p.name} description={p.description} />
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
