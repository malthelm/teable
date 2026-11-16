import { useBase } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { MessageSquare } from 'lucide-react';
import { useRouter } from 'next/router';
import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RADIO_BASE } from '../radio/radio-data';
import { AskTrueNature } from './AskTrueNature';
import styles from './panel.module.css';

const AskPanelContext = createContext<{ open: boolean; show: () => void }>({
  open: false,
  show: () => undefined,
});
export const useAskPanel = () => useContext(AskPanelContext);
export function AskPanelWorkspace({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const base = useBase();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [wide, setWide] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const enabled = base.id === RADIO_BASE && !disabled;
  const show = useCallback(() => {
    setVisited(true);
    setOpen(true);
  }, []);
  const collapse = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1200px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (enabled && router.query.ask === '1') show();
  }, [enabled, router.query.ask, show]);
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    dialog.close();
    if (enabled && open) {
      if (wide) dialog.show();
      else dialog.showModal();
    }
  }, [enabled, open, wide, visited]);
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setVisited(false);
    }
  }, [enabled]);
  return (
    <AskPanelContext.Provider value={{ open, show }}>
      {children}
      {enabled && (
        <>
          <div className={styles.rail} data-open={open}>
            <Button
              ref={trigger}
              variant="ghost"
              size="icon"
              aria-label="Open Ask True Nature"
              title="Ask True Nature"
              aria-expanded={open}
              aria-controls="ask-true-nature-panel"
              onClick={show}
            >
              <MessageSquare size={18} />
            </Button>
          </div>
          <dialog
            ref={panel}
            id="ask-true-nature-panel"
            aria-label="Ask True Nature"
            className={styles.panel}
            onCancel={(event) => {
              event.preventDefault();
              collapse();
            }}
          >
            {visited && <AskTrueNature compact onCollapse={collapse} />}
          </dialog>
        </>
      )}
    </AskPanelContext.Provider>
  );
}
