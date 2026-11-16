import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import { AirtableDashboards } from '@/features/app/airtable/AirtableDashboards';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { RADIO_BASE } from '@/features/app/radio/radio-data';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import ensureLogin from '@/lib/ensureLogin';
import handleBase from '@/lib/handleBase';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const InsightsPage: NextPageWithLayout = () => <AirtableDashboards />;
InsightsPage.getLayout = (page, props) => <BaseLayout {...props}>{page}</BaseLayout>;

const authorizedPage = withEnv(
  ensureLogin(
    withAuthSSR(async (context, api) => {
      context.res.setHeader('Cache-Control', 'private, no-store');
      if (context.query.baseId !== RADIO_BASE) return { notFound: true };
      const client = new QueryClient();
      const base = await handleBase(RADIO_BASE, api, client);
      await Promise.all([
        client.fetchQuery({ queryKey: ReactQueryKeys.base(RADIO_BASE), queryFn: () => base }),
        client.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(RADIO_BASE),
          queryFn: () => api.getBasePermission(RADIO_BASE),
        }),
      ]);
      return {
        props: {
          base,
          tableServerData: await api.getTables(RADIO_BASE),
          dehydratedState: dehydrate(client),
          ...(await getTranslationsProps(context, baseAllConfig.i18nNamespaces)),
        },
      };
    })
  )
);

export const getServerSideProps: GetServerSideProps = async (context) => {
  const result = await authorizedPage(context);
  if ('redirect' in result && result.redirect.destination.startsWith('/auth/')) {
    return {
      redirect: {
        destination: `/auth/login?redirect=${encodeURIComponent(context.resolvedUrl)}`,
        permanent: false,
      },
    };
  }
  return result;
};

export default InsightsPage;
