// import { TableList } from '../../table-list/TableList';
import { useBase } from '@teable/sdk/hooks';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { BarChart3, Disc3, MessageSquare, Radio } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BaseNodeTree } from './BaseNodeTree';
import { BasePageRouter } from './BasePageRouter';
import { useCloseMobileSidebarSheet } from '@/features/app/components/toggle-side-bar/SheetWrapper';
import { RADIO_BASE, RADIO_HOME } from '@/features/app/radio/radio-data';

export const BaseSideBar = (props: {
  renderWinFreeCredit?: (spaceId: string) => React.ReactNode;
  renderAnnouncementCard?: () => React.ReactNode;
}) => {
  const { renderWinFreeCredit, renderAnnouncementCard } = props;
  const base = useBase();
  const router = useRouter();
  const closeSidebar = useCloseMobileSidebarSheet();
  return (
    <>
      <BasePageRouter />
      {base.id === RADIO_BASE && (
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            'mx-3 justify-start gap-2 text-sm font-normal',
            router.asPath === RADIO_HOME && 'bg-secondary'
          )}
          asChild
        >
          <Link
            href={RADIO_HOME}
            onClick={closeSidebar}
            aria-current={router.asPath === RADIO_HOME ? 'page' : undefined}
          >
            <Radio size={16} />
            Radio dashboard
          </Link>
        </Button>
      )}
      {base.id === RADIO_BASE && (
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            'mx-3 justify-start gap-2 text-sm font-normal',
            router.pathname.endsWith('/releases') && 'bg-secondary'
          )}
          asChild
        >
          <Link
            href={`/base/${RADIO_BASE}/releases`}
            onClick={closeSidebar}
            aria-current={router.pathname.endsWith('/releases') ? 'page' : undefined}
          >
            <Disc3 size={16} />
            Releases
          </Link>
        </Button>
      )}
      {base.id === RADIO_BASE && (
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            'mx-3 justify-start gap-2 text-sm font-normal',
            router.pathname.endsWith('/insights') && 'bg-secondary'
          )}
          asChild
        >
          <Link
            href={`/base/${RADIO_BASE}/insights`}
            onClick={closeSidebar}
            aria-current={router.pathname.endsWith('/insights') ? 'page' : undefined}
          >
            <BarChart3 size={16} /> Airtable dashboards
          </Link>
        </Button>
      )}
      {base.id === RADIO_BASE && (
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            'mx-3 justify-start gap-2 text-sm font-normal',
            router.pathname.endsWith('/ask') && 'bg-secondary'
          )}
          asChild
        >
          <Link
            href={`/base/${RADIO_BASE}/ask`}
            onClick={closeSidebar}
            aria-current={router.pathname.endsWith('/ask') ? 'page' : undefined}
          >
            <MessageSquare size={16} /> Ask True Nature
          </Link>
        </Button>
      )}
      {/* <TableList /> */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BaseNodeTree />
      </div>
      {renderWinFreeCredit && renderWinFreeCredit(base.spaceId)}
      {renderAnnouncementCard && renderAnnouncementCard()}
    </>
  );
};
