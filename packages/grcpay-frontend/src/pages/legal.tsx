import type { GetServerSidePropsContext } from 'next';
import { Page } from '@/routes/legal';
import { withThemeDataServerSide } from '@/lib/modeDataServer';

export const getServerSideProps = withThemeDataServerSide(
  async (_context: GetServerSidePropsContext) => ({
    props: {},
  }),
);

export default Page;
