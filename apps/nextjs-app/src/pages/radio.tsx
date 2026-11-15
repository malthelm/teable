import type { GetServerSideProps } from 'next';
import { RADIO_HOME } from '@/features/app/radio/radio-data';

// Keep installed-app and shared bookmarks stable while using the existing base layout.
export default function RadioShortcut() {
  return null;
}
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: RADIO_HOME, permanent: false },
});
