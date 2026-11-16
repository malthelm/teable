import { Selector } from '@teable/ui-lib/base';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { ArrowUpRight, Disc3, RefreshCw } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { RADIO_BASE, RADIO_HOME, RADIO_RECORDS, countryName } from '../radio/radio-data';
import {
  defaultRelease,
  isTestRelease,
  loadRadioCatalog,
  matchRadio,
  RELEASE_HOME,
} from './release-data';
import type { WorkspaceData } from './release-data';
import styles from './release.module.css';

const date = (value: string | null) => {
  if (!value) return 'Not set';
  const d = new Date(value.slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
};
const readiness = (value: boolean | null) =>
  value === true ? 'Ready' : value === false ? 'Needs attention' : 'Not assessed';
const status = (value: string | null) => (value ? value.replaceAll('_', ' ') : 'Not set');
function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3 shrink-0" />
    </a>
  );
}

// Branches render source loading, selection, and empty states for the five release sections.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function ReleaseWorkspace() {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [includeTests, setIncludeTests] = useState(false);
  const [radio, setRadio] = useState<Awaited<ReturnType<typeof loadRadioCatalog>>>();
  const [radioError, setRadioError] = useState('');
  const [tab, setTab] = useState('overview');
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        const response = await fetch(`/api/base/${RADIO_BASE}/label-suite/releases`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(
            response.status === 401 || response.status === 403
              ? 'Sign in with an account that has access to this workspace.'
              : 'Label Suite could not be refreshed. Please try again.'
          );
        const result = await response.json();
        if (
          !['releases', 'tracks', 'milestones', 'campaigns'].every((k) => Array.isArray(result[k]))
        )
          throw new Error('Label Suite returned an unexpected response.');
        setData(result);
        setError('');
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Unable to load Label Suite.');
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setRadioError('');
    loadRadioCatalog(controller.signal)
      .then(setRadio)
      .catch(() => {
        if (!controller.signal.aborted)
          setRadioError('Radio data is unavailable. Label Suite details are still available.');
      });
    return () => controller.abort();
  }, [revision]);
  const releases = useMemo(
    () => data?.releases.filter((r) => includeTests || !isTestRelease(r)) || [],
    [data, includeTests]
  );
  const requested = typeof router.query.releaseId === 'string' ? router.query.releaseId : '';
  const release =
    releases.find((r) => r.id === requested) ||
    releases.find((r) => r.id === defaultRelease(releases, new Date().toLocaleDateString('en-CA')));
  const tracks = data?.tracks.filter((t) => t.release_id === release?.id) || [];
  const milestones = data?.milestones.filter((m) => m.release_id === release?.id) || [];
  const campaigns = data?.campaigns.filter((c) => c.release_id === release?.id) || [];
  const coverage = radio ? matchRadio(tracks, radio.catalog, radio.plays) : undefined;
  const source =
    release && data ? `${data.sourceOrigin}/releases/${encodeURIComponent(release.id)}` : '';
  const choose = (id: string) => {
    setTab('overview');
    void router.replace({ pathname: RELEASE_HOME, query: { releaseId: id } }, undefined, {
      shallow: true,
    });
  };
  const testCount = data?.releases.filter(isTestRelease).length || 0;
  return (
    <div className={styles.page}>
      <Head>
        <title>Releases · True Nature Tables</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <header className={styles.header}>
        <h1 className="flex items-center gap-2 text-sm font-medium">
          <Disc3 className="size-4" />
          Releases
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh releases"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw className="size-4" />
          </Button>
          {source && (
            <Button variant="outline" size="xs" asChild>
              <a href={source} target="_blank" rel="noopener noreferrer">
                Label Suite
                <ArrowUpRight className="size-3" />
              </a>
            </Button>
          )}
        </div>
      </header>
      <div className={styles.content}>
        {error && (
          <div role="alert" className="border-destructive/40 mb-4 rounded-md border p-3 text-sm">
            {error}
            {data && ' Showing the last successful refresh.'}
            <Button size="xs" variant="link" onClick={() => setRevision((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        {!data ? (
          <p role="status" className="text-muted-foreground p-6 text-sm">
            {loading ? 'Loading Label Suite releases…' : 'Release data is unavailable.'}
          </p>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label className="text-muted-foreground text-xs">Release · {releases.length}</Label>
                <Selector
                  ariaLabel="Release"
                  selectedId={release?.id}
                  candidates={releases.map((r) => ({
                    id: r.id,
                    name: `${r.title} · ${r.artist || 'Unknown artist'}`,
                  }))}
                  onChange={choose}
                  searchTip="Search releases…"
                  className="w-full justify-between"
                  contentClassName="max-w-[min(500px,calc(100vw-32px))]"
                />
              </div>
              <Label className="flex items-center gap-2 text-xs font-normal">
                <Checkbox
                  checked={includeTests}
                  onCheckedChange={(value) => setIncludeTests(value === true)}
                />
                Include test releases ({testCount})
              </Label>
            </div>
            <div className={styles.freshness}>
              <span>Label Suite · Read only · Refreshes every minute</span>
              <span>
                Updated{' '}
                <time dateTime={data.refreshedAt}>
                  {new Date(data.refreshedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </span>
            </div>
            {!release ? (
              <p>No releases in this selection.</p>
            ) : (
              <>
                <div className={styles.title}>
                  <div>
                    <h2>{release.title}</h2>
                    <p>
                      {release.artist || 'Unknown artist'} · {release.format || 'Format not set'} ·{' '}
                      {date(release.release_date)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {status(release.status)}
                  </Badge>
                </div>
                <Tabs value={tab} onValueChange={setTab}>
                  <div className="mb-4 overflow-x-auto">
                    <TabsList aria-label="Release sections">
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="tracks">Tracks ({tracks.length})</TabsTrigger>
                      <TabsTrigger value="timeline">Timeline ({milestones.length})</TabsTrigger>
                      <TabsTrigger value="campaigns">Campaigns ({campaigns.length})</TabsTrigger>
                      <TabsTrigger value="radio">Radio</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="overview">
                    <div className={styles.metrics}>
                      {[
                        ['Label Suite readiness', readiness(release.release_ready)],
                        ['Tracks', `${tracks.length}`],
                        [
                          'ISRCs recorded',
                          `${tracks.filter((t) => !!t.isrc?.trim()).length} / ${tracks.length}`,
                        ],
                        [
                          'Audio linked',
                          `${tracks.filter((t) => t.has_audio).length} / ${tracks.length}`,
                        ],
                      ].map(([label, value]) => (
                        <Card key={label} className="p-4">
                          <p className="text-muted-foreground mb-2 text-xs">{label}</p>
                          <strong className="text-lg font-semibold">{value}</strong>
                        </Card>
                      ))}
                    </div>
                    <div className={styles.columns}>
                      <Card className="p-4">
                        <h3 className={styles.heading}>Release details</h3>
                        <dl className={styles.details}>
                          {[
                            ['Artist', release.artist],
                            ['Format', release.format],
                            ['Release date', date(release.release_date)],
                            ['UPC / EAN', release.upc_ean],
                            ['Delivery', release.delivery_status],
                            [
                              'Cover artwork',
                              release.has_cover ? 'Linked in Label Suite' : 'Not linked',
                            ],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value || 'Not set'}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="mt-4 text-xs">
                          <SourceLink href={source}>Open original release</SourceLink>
                        </div>
                      </Card>
                      <Card className="p-4">
                        <h3 className={styles.heading}>Needs attention</h3>
                        <p className="text-muted-foreground mb-3 text-xs">
                          Readiness reported by Label Suite. Missing links describe what is
                          recorded, not whether an asset exists elsewhere.
                        </p>
                        {release.release_missing ? (
                          <>
                            <p className="text-sm">
                              {tracks.filter((t) => t.track_ready === false).length} of{' '}
                              {tracks.length} tracks need attention in Label Suite.
                            </p>
                            <details className="mt-3 text-sm">
                              <summary className="cursor-pointer">
                                Show Label Suite checklist
                              </summary>
                              <p className="text-muted-foreground mt-2 whitespace-pre-wrap leading-6">
                                {release.release_missing}
                              </p>
                            </details>
                          </>
                        ) : (
                          <p className="text-sm">
                            {release.release_ready
                              ? 'Label Suite reports this release as ready.'
                              : 'No readiness details recorded.'}
                          </p>
                        )}
                        <Button
                          className="mt-4"
                          variant="outline"
                          size="xs"
                          onClick={() => setTab('tracks')}
                        >
                          Review tracks
                        </Button>
                      </Card>
                    </div>
                  </TabsContent>
                  <TabsContent value="tracks">
                    <Card className="overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Track</TableHead>
                            <TableHead>ISRC</TableHead>
                            <TableHead>Audio</TableHead>
                            <TableHead>Readiness</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tracks.map((t) => (
                            <TableRow key={t.id}>
                              <TableCell className="min-w-44">
                                <SourceLink href={`${source}/tracks`}>
                                  {t.position ? `${t.position}. ` : ''}
                                  {t.title}
                                </SourceLink>
                                {t.version && (
                                  <p className="text-muted-foreground mt-1 text-xs">{t.version}</p>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs">
                                {t.isrc || 'Not recorded'}
                              </TableCell>
                              <TableCell>{t.has_audio ? 'Linked' : 'Not linked'}</TableCell>
                              <TableCell className="min-w-56">
                                <span>{readiness(t.track_ready)}</span>
                                {t.track_missing && (
                                  <p className="text-muted-foreground mt-1 text-xs">
                                    {t.track_missing}
                                  </p>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {!tracks.length && (
                        <p className="text-muted-foreground p-4 text-sm">
                          No tracks linked to this release in Label Suite.
                        </p>
                      )}
                    </Card>
                  </TabsContent>
                  <TabsContent value="timeline">
                    <Card className="p-4">
                      <h3 className={styles.heading}>Release milestones</h3>
                      {milestones.length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Milestone</TableHead>
                              <TableHead>Due</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {milestones.map((m) => (
                              <TableRow key={m.id}>
                                <TableCell>
                                  {m.title}
                                  {m.is_blocking && (
                                    <Badge variant="secondary" className="ms-2">
                                      Blocking
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>{date(m.due_date)}</TableCell>
                                <TableCell>{status(m.status)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          No milestones recorded for this release. Add them in Label Suite and they
                          will appear here after refresh.
                        </p>
                      )}
                      <p className="mt-4 text-xs">
                        <SourceLink href={source}>Open release timeline in Label Suite</SourceLink>
                      </p>
                    </Card>
                  </TabsContent>
                  <TabsContent value="campaigns">
                    <Card className="overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Campaign</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Dates</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {campaigns.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                <SourceLink
                                  href={`${data.sourceOrigin}/campaigns/${encodeURIComponent(c.id)}`}
                                >
                                  {c.campaign_name}
                                </SourceLink>
                                <p className="text-muted-foreground mt-1 text-xs">
                                  {[c.campaign_type, c.main_platform].filter(Boolean).join(' · ')}
                                </p>
                              </TableCell>
                              <TableCell>{status(c.status)}</TableCell>
                              <TableCell>
                                {date(c.start_date)} – {date(c.end_date)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {!campaigns.length && (
                        <p className="text-muted-foreground p-4 text-sm">
                          No campaigns linked to this release in Label Suite.
                        </p>
                      )}
                    </Card>
                  </TabsContent>
                  <TabsContent value="radio">
                    <Card className="p-4">
                      <h3 className={styles.heading}>Recorded radio plays</h3>
                      {radioError ? (
                        <p role="alert">{radioError}</p>
                      ) : !coverage ? (
                        <p role="status">Loading radio data…</p>
                      ) : (
                        <>
                          <p className="text-muted-foreground mb-4 text-sm">
                            {coverage.matched} of {tracks.length} tracks matched to Songstats by
                            exact ISRC.
                            {coverage.ambiguous
                              ? ` ${coverage.ambiguous} ambiguous matches excluded.`
                              : ''}{' '}
                            {coverage.matched < tracks.length &&
                              'Unmatched tracks are excluded from the play count.'}
                          </p>
                          {!coverage.matched ? (
                            <p className="text-sm">
                              No confirmed matches yet. Add the correct ISRCs in Label Suite to
                              connect these tracks.
                            </p>
                          ) : (
                            <>
                              <p className="mb-3 text-lg font-semibold">
                                {coverage.plays.length.toLocaleString()} imported plays
                              </p>
                              <p className="text-muted-foreground mb-3 text-xs">
                                Songstats snapshot imported {date(radio?.plays[0]?.fetched || null)}
                                . Includes all available dates; coverage may be incomplete.
                              </p>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Track / station</TableHead>
                                    <TableHead>Played at (UTC)</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {coverage.plays.slice(0, 15).map((p) => (
                                    <TableRow key={p.id}>
                                      <TableCell>
                                        <Link
                                          className="hover:underline"
                                          href={`${RADIO_RECORDS}?recordId=${p.id}`}
                                        >
                                          {p.track}
                                        </Link>
                                        <p className="text-muted-foreground mt-1 text-xs">
                                          {p.station} · {countryName(p.country)}
                                        </p>
                                      </TableCell>
                                      <TableCell className="text-xs">
                                        {date(p.day)} · {p.at.slice(11, 16)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                              {!coverage.plays.length && (
                                <p className="text-sm">
                                  No timestamped plays imported for the matched tracks.
                                </p>
                              )}
                            </>
                          )}
                        </>
                      )}
                      <div className="mt-4 text-xs">
                        <Link className="underline" href={RADIO_HOME}>
                          Open full radio dashboard
                        </Link>
                      </div>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
