import type { GetServerSideProps } from 'next';
import { RADIO_BASE, RADIO_LOGIN } from '@/features/app/radio/radio-data';
import { RadioDashboard } from '@/features/app/radio/RadioDashboard';
import { systemConfig } from '@/features/i18n/system.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

export default RadioDashboard;

const authorizedPage = withEnv(
  ensureLogin(
    withAuthSSR(async (context, api) => {
      context.res.setHeader('Cache-Control', 'private, no-store');
      // Use the same base authorization as the table UI; no service token or public snapshot.
      await api.axios.get(`/base/${RADIO_BASE}`);
      return { props: { ...(await getTranslationsProps(context, systemConfig.i18nNamespaces)) } };
    })
  )
);

export const getServerSideProps: GetServerSideProps = async (context) => {
  const result = await authorizedPage(context);
  if ('redirect' in result && result.redirect.destination.startsWith('/auth/')) {
    return { redirect: { destination: RADIO_LOGIN, permanent: false } };
  }
  return result;
};
