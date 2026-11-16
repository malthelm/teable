import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { useEffect, useRef, useState } from 'react';
import { RADIO_BASE } from './radio-data';

const endpoint = `/api/base/${RADIO_BASE}/radio-sync`;
interface SyncStatus {
  coverageWarnings: string[];
  connected: boolean;
  enabled: boolean;
  running: boolean;
  canManage: boolean;
  lastSuccess: string | null;
  lastError: string | null;
  nextRun: string | null;
  heartbeat: string | null;
}
const date = (value: string) => new Date(value).toLocaleString();
// eslint-disable-next-line sonarjs/cognitive-complexity -- Connection form and explicit status states.
export function RadioSyncConnection({
  onUpdated,
  manage = true,
}: {
  onUpdated?: () => void;
  manage?: boolean;
}) {
  const [status, setStatus] = useState<SyncStatus>();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const lastSuccess = useRef<string | null | undefined>(undefined);
  const update = useRef(onUpdated);
  update.current = onUpdated;
  async function load(signal?: AbortSignal) {
    try {
      const response = await fetch(endpoint, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const value: SyncStatus = await response.json();
      if (lastSuccess.current !== undefined && lastSuccess.current !== value.lastSuccess)
        update.current?.();
      lastSuccess.current = value.lastSuccess;
      setStatus(value);
      setUnavailable(false);
    } catch {
      if (!signal?.aborted) setUnavailable(true);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    const timer = setInterval(() => void load(abort.signal), 30000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  async function action(name: 'connect' | 'refresh' | 'pause') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const apiKey = key;
    if (name === 'connect') setKey('');
    try {
      const response = await fetch(`${endpoint}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name === 'connect' ? { apiKey } : {}),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          typeof data.message === 'string' ? data.message : 'The connection could not be updated.'
        );
      }
      await load();
      setNotice(
        name === 'pause'
          ? 'Automatic checks paused. A running update may finish.'
          : 'Update queued. The worker checks for requests every minute; rate-limit waits still apply.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The connection could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  const overdue =
    status?.enabled && status.heartbeat && Date.now() - Date.parse(status.heartbeat) > 5 * 60000;
  return (
    <div
      className="text-muted-foreground my-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      aria-label="Songstats update status"
    >
      <span>
        {unavailable
          ? 'Update status unavailable'
          : !status
            ? 'Checking Songstats connection…'
            : status.running
              ? 'Updating radio plays…'
              : status.enabled
                ? overdue
                  ? 'Update worker needs attention'
                  : 'Songstats · hourly checks'
                : status.connected
                  ? 'Songstats · checks paused'
                  : 'Songstats · connection needed'}
      </span>
      {status?.lastSuccess && (
        <span title={status.lastSuccess}>Last complete update {date(status.lastSuccess)}</span>
      )}
      {status?.lastError && (
        <span className="text-destructive">Last update failed; retained plays are available.</span>
      )}
      {manage && status?.canManage && (
        <Button variant="link" size="xs" onClick={() => setOpen(true)}>
          {status.connected ? 'Manage connection' : 'Connect Songstats'}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setKey('');
            setError('');
            setNotice('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Songstats connection</DialogTitle>
            <DialogDescription>
              Keep True Nature’s radio detections up to date with hourly checks.
            </DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Enter an existing Songstats API key with access to the True Nature label. It is sent
            over HTTPS and stored in a restricted file on your server. It is never returned to the
            browser or included in assistant requests.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action('connect');
            }}
            className="space-y-3"
          >
            <Label htmlFor="songstats-api-key">
              {status?.connected ? 'Replace API key' : 'Songstats API key'}
            </Label>
            <Input
              id="songstats-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              maxLength={2048}
              disabled={busy}
              required
              className="text-base"
            />
            <p className="text-muted-foreground text-xs">
              Use your existing key where possible. Generating a replacement in Songstats may
              disconnect other integrations. Songstats access and usage limits apply.
            </p>
            <Button type="submit" disabled={busy || !key.trim()}>
              {busy ? 'Checking…' : 'Connect and enable hourly updates'}
            </Button>
          </form>
          {status?.connected && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                variant="outline"
                disabled={busy || status.running}
                onClick={() => void action('refresh')}
              >
                {status.enabled ? 'Check now' : 'Resume hourly checks'}
              </Button>
              {status.enabled && (
                <Button variant="ghost" disabled={busy} onClick={() => void action('pause')}>
                  Pause checks
                </Button>
              )}
            </div>
          )}
          {status?.coverageWarnings?.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
          {status?.nextRun && (
            <p className="text-muted-foreground text-xs">
              Next scheduled check: {date(status.nextRun)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            Updates preserve existing plays and saved views. New broadcasts appear when Songstats
            reports them; this does not calculate royalties.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
