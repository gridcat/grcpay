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
import { Seo, SITE_NAME } from '@/components/Seo';
import { PageWrapper } from '@/components/PageWrapper';
import { WooCommerceCard } from './Cards/WooCommerceCard';
import { ComingSoonCard } from './Cards/ComingSoonCard';

const comingSoon: { name: string; description: string }[] = [
  {
    name: 'Shopify',
    description:
      'Storefront app for Shopify merchants. Same one-click checkout flow, same on-chain settlement.',
  },
  {
    name: 'Magento',
    description:
      'Adobe Commerce module — drop-in payment method that talks to a self-hosted GRCpay instance.',
  },
  {
    name: 'PrestaShop',
    description:
      'PrestaShop module mirroring the WooCommerce plugin: install, point at your GRCpay URL, you\u2019re live.',
  },
];

export function Page() {
  return (
    <>
      <Seo
        title={`${SITE_NAME} :: Integrations`}
        description="Ecommerce plugins and integrations that wrap the GRCpay API for popular checkout platforms."
        path="/integrations"
      />
      <PageWrapper>
        <Header />
        <Container maxWidth="lg" sx={{ flexGrow: 1, py: 4 }}>
          <GradientLine />
          <Typography component="h1" variant="h4" sx={{ pb: 2 }}>
            Integrations
          </Typography>
          <Typography gutterBottom variant="body1" component="p" sx={{ pb: 3 }}>
            GRCpay ships with first-party plugins for the most common ecommerce
            platforms. Each plugin wraps the API so merchants can accept
            Gridcoin payments without writing any code, and where possible we
            host a live test installation you can try right now.
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
