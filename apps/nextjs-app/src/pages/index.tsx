import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
type Props = {/** Add HomeRoute props here */};

export default function DemoRoute(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <></>;
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  // Preserve query parameters when redirecting to /space
  const queryString = context.req.url?.split('?')[1];
  const home = process.env.TRUE_NATURE_RADIO_HOME === 'true' ? '/radio' : '/space';
  const destination = queryString ? `${home}?${queryString}` : home;
  return {
    redirect: {
      destination,
      permanent: false,
    },
  };
};
