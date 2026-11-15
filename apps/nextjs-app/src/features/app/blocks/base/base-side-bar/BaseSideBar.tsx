// import { TableList } from '../../table-list/TableList';
import { useBase } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { Radio } from 'lucide-react';
import Link from 'next/link';
import { RADIO_BASE } from '@/features/app/radio/radio-data';
import { BaseNodeTree } from './BaseNodeTree';
import { BasePageRouter } from './BasePageRouter';

export const BaseSideBar = (props: {
  renderWinFreeCredit?: (spaceId: string) => React.ReactNode;
  renderAnnouncementCard?: () => React.ReactNode;
}) => {
  const { renderWinFreeCredit, renderAnnouncementCard } = props;
  const base = useBase();
  return (
    <>
      <BasePageRouter />
      {base.id === RADIO_BASE && (
        <Button variant="ghost" className="mx-3 justify-start gap-2" asChild>
          <Link href="/radio">
            <Radio size={16} />
            Radio dashboard
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
