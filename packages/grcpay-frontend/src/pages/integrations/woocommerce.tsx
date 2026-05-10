import type { GetServerSidePropsContext } from 'next';
import { Page } from '@/routes/integrations/woocommerce';
import { withThemeDataServerSide } from '@/lib/modeDataServer';

// The WooCommerce plugin is in beta testing — hide the public page until
// it's ready to ship. Returning notFound keeps the route compiled (so we
// can flip it back on in one line) but serves a 404 to crawlers and users.
export const getServerSideProps = withThemeDataServerSide(
  async (_context: GetServerSidePropsContext) => ({
    notFound: true as const,
  }),
);

export default Page;
