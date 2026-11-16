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
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { RADIO_BASE } from './radio-data';

const endpoint = `/api/base/${RADIO_BASE}/radio-sync`;
interface SyncStatus {
  connectionType: 'oauth' | 'apiKey';
  reconnectRequired: boolean;
  oauthLastError: string | null;
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
  const router = useRouter();
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
  async function action(name: 'connect' | 'refresh' | 'pause' | 'oauth/disconnect') {
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
        name === 'oauth/disconnect'
          ? 'Songstats disconnected. Automatic updates are off.'
          : name === 'pause'
            ? 'Automatic checks paused. A running update may finish.'
            : 'Update queued. The worker checks for requests every minute; rate-limit waits still apply.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The connection could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!manage || typeof router.query.songstats !== 'string') return;
    const result = router.query.songstats;
    setOpen(true);
    if (result === 'connected') setNotice('Songstats connected. The first radio update is queued.');
    else
      setError(
        result === 'cancelled'
          ? 'Sign-in cancelled. The saved connection has not changed.'
          : 'Songstats sign-in could not be completed. Please check the connection details below.'
      );
    const { songstats: _result, ...query } = router.query;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [router, router.query, router.pathname, manage]);
  async function connectOAuth() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${endpoint}/oauth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string')
        throw new Error(data.message || 'Songstats sign-in could not start.');
      const url = new URL(data.url);
      if (url.origin !== 'https://api.songstats.com' || url.pathname !== '/oauth/authorize')
        throw new Error('Unexpected sign-in destination.');
      window.location.assign(url.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Songstats sign-in could not start.');
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
        <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Songstats connection</DialogTitle>
            <DialogDescription>
              Keep True Nature’s radio detections up to date with hourly checks.
            </DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Sign in to Songstats and approve read-only access for True Nature Tables. No API key is
            needed. Your server keeps the connection refreshed for hourly updates.
          </p>
          <Button disabled={busy} onClick={() => void connectOAuth()}>
            {busy
              ? 'Connecting…'
              : status?.connected && status.connectionType === 'oauth'
                ? 'Reconnect with Songstats'
                : 'Connect with Songstats'}
          </Button>
          {status?.connected && status.connectionType === 'oauth' && (
            <p className="text-muted-foreground text-xs">
              Connected with Songstats · read-only access
            </p>
          )}
          {status?.oauthLastError && (
            <p role="alert" className="text-destructive text-sm">
              {status.oauthLastError}
            </p>
          )}
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">
              Advanced: use an API key
            </summary>
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
          </details>
          {status?.connected && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                variant="outline"
                disabled={busy || status.running}
                onClick={() => void action('refresh')}
              >
                {status.enabled ? 'Check now' : 'Resume hourly checks'}
              </Button>
              {status.connectionType === 'oauth' && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void action('oauth/disconnect')}
                >
                  Disconnect Songstats
                </Button>
              )}
              {status.enabled && (
                <Button variant="ghost" disabled={busy} onClick={() => void action('pause')}>
                  Pause checks
                </Button>
              )}
            </div>
          )}
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
