import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@teable/ui-lib/shadcn';
import { ArrowUpRight, Filter, LayoutDashboard, RefreshCw, Table2 } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RadioSyncConnection } from './RadioSyncConnection';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  countryName,
  dateWindow,
  filterPlays,
  loadPlays,
  rankPlays,
  timeline,
  RADIO_RECORDS,
  RADIO_TOTALS,
  RADIO_LOGIN,
} from './radio-data';
import type { Play, Rank } from './radio-data';
import styles from './radio.module.css';
import { RadioFilter, RadioPeriod } from './RadioFilter';

const number = (n: number) => n.toLocaleString('en');
const EMPTY_PLAYS: Play[] = [];
const dateLabel = (value: string, withTime = false) =>
  value
    ? new Date(value.length === 10 ? value + 'T00:00:00Z' : value).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
        ...(withTime ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
      })
    : '—';

function Ranking({
  title,
  rows,
  onSelect,
}: {
  title: string;
  rows: Rank[];
  onSelect: (key: string) => void;
}) {
  const shown = rows.slice(0, 7);
  return (
    <Card className={styles.card} role="region" aria-label={title}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        <span>Recorded plays</span>
      </div>
      {shown.length ? (
        <ol className={styles.ranking}>
          {shown.map((row) => (
            <li key={row.key}>
              <Button
                variant="ghost"
                onClick={() => onSelect(row.key)}
                aria-label={`Filter to ${row.label}, ${number(row.count)} plays`}
              >
                <span className={styles.rankLabel}>{row.label}</span>
                <strong>{number(row.count)}</strong>
                <span className={styles.barTrack} aria-hidden="true">
                  <span style={{ width: `${(row.count / shown[0].count) * 100}%` }} />
                </span>
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No plays in this selection.</p>
      )}
      {rows.length > 7 && (
        <p className={styles.footnote}>
          Top 7 of {number(rows.length)} · choose any in the filters
        </p>
      )}
    </Card>
  );
}

// The branches below render loading, filtering and empty states; calculations live in radio-data.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function RadioDashboard() {
  const [data, setData] = useState<{ plays: Play[]; missingDates: number }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState('30');
  const [track, setTrack] = useState('');
  const [country, setCountry] = useState('');
  const [station, setStation] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [visibleCount, setVisibleCount] = useState(15);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(undefined);
    loadPlays(controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Unable to load radio data.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const all = data?.plays || EMPTY_PLAYS;
  const latestDay = all[0]?.day || '';
  const firstDay = all[all.length - 1]?.day || '';
  const start =
    period === 'custom'
      ? customStart
      : period === 'all'
        ? firstDay
        : dateWindow(latestDay, Number(period));
  const end = period === 'custom' ? customEnd : latestDay;
  const invalidRange = period === 'custom' && (!start || !end || start > end);
  const selected = useMemo(
    () =>
      invalidRange ? [] : filterPlays(data?.plays || [], { start, end, track, country, station }),
    [data, start, end, track, country, station, invalidRange]
  );
  const series = useMemo(() => timeline(selected, start, end), [selected, start, end]);
  const tracks = useMemo(
    () => rankPlays(all, 'track').sort((a, b) => a.label.localeCompare(b.label)),
    [all]
  );
  const stations = useMemo(
    () => rankPlays(all, 'station').sort((a, b) => a.label.localeCompare(b.label)),
    [all]
  );
  const countries = useMemo(
    () => rankPlays(all, 'country').sort((a, b) => a.label.localeCompare(b.label)),
    [all]
  );
  const topTracks = useMemo(() => rankPlays(selected, 'track'), [selected]);
  const topStations = useMemo(() => rankPlays(selected, 'station'), [selected]);
  const topCountries = useMemo(() => rankPlays(selected, 'country'), [selected]);
  const imported = all.reduce(
    (latest, play) => (play.fetched > latest ? play.fetched : latest),
    ''
  );
  const knownCountries = topCountries.filter((c) => c.key !== 'unknown').length;
  const reset = () => {
    setPeriod('30');
    setTrack('');
    setCountry('');
    setStation('');
    setVisibleCount(15);
  };
  useEffect(() => setVisibleCount(15), [start, end, track, country, station]);

  return (
    <div className={styles.page}>
      <Head>
        <title>Radio dashboard · True Nature Tables</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <header className={styles.header}>
        <h1 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <LayoutDashboard className="size-4 shrink-0" />
          <span className="truncate">Radio dashboard</span>
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={loading}
            aria-label="Reload data"
            title="Reload imported records"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="outline" size="xs" asChild>
            <Link href={RADIO_RECORDS}>
              <Table2 className="size-4" />
              Records
            </Link>
          </Button>
        </div>
      </header>
      <div className={styles.main}>
        <RadioSyncConnection onUpdated={() => setRevision((value) => value + 1)} />
        {loading ? (
          <div role="status" className={styles.state}>
            Loading radio plays…
          </div>
        ) : error ? (
          <div role="alert" className={styles.state}>
            <h2>Couldn’t load the dashboard</h2>
            <p>{error}</p>
            <Button size="sm" onClick={() => setRevision((value) => value + 1)}>
              Try again
            </Button>
            <Link href={RADIO_LOGIN}>Sign in</Link>
          </div>
        ) : !all.length ? (
          <div className={styles.state}>No timestamped radio plays are available yet.</div>
        ) : (
          <>
            <div className={styles.freshness}>
              <span>Songstats imported {dateLabel(imported)}</span>
              <Badge variant="secondary" className="font-normal">
                Songstats radio detections
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={styles.mobileFilters}
              aria-expanded={showFilters}
              aria-controls="radio-filters"
              onClick={() => setShowFilters((value) => !value)}
            >
              <Filter className="size-4" />
              {showFilters ? 'Hide filters' : 'Filters'}
            </Button>
            <section
              id="radio-filters"
              className={styles.filters}
              data-open={showFilters}
              aria-label="Filter radio plays"
            >
              <RadioPeriod
                value={period}
                onChange={(next) => {
                  setPeriod(next);
                  if (next === 'custom') {
                    setCustomStart(start);
                    setCustomEnd(end);
                  }
                }}
              />
              <RadioFilter label="Track" value={track} onChange={setTrack} items={tracks} />
              <RadioFilter
                label="Country"
                value={country}
                onChange={setCountry}
                items={countries}
              />
              <RadioFilter label="Station" value={station} onChange={setStation} items={stations} />
              {period === 'custom' && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="radio-from" className="text-muted-foreground text-xs">
                      From (UTC)
                    </Label>
                    <Input
                      id="radio-from"
                      aria-label="From (UTC)"
                      type="date"
                      value={customStart}
                      min={firstDay}
                      max={latestDay}
                      onChange={(event) => setCustomStart(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="radio-through" className="text-muted-foreground text-xs">
                      Through (UTC)
                    </Label>
                    <Input
                      id="radio-through"
                      aria-label="Through (UTC)"
                      type="date"
                      value={customEnd}
                      min={firstDay}
                      max={latestDay}
                      onChange={(event) => setCustomEnd(event.target.value)}
                    />
                  </div>
                </>
              )}
              <Button variant="ghost" size="xs" onClick={reset}>
                Reset filters
              </Button>
            </section>
            <div className={styles.scope} aria-live="polite">
              {invalidRange
                ? 'Choose a start date on or before the end date.'
                : `${dateLabel(start)} – ${dateLabel(end)} · UTC`}
              {(track || country || station) && (
                <div className={styles.activeFilters}>
                  {[
                    tracks.find((item) => item.key === track)?.label,
                    country ? countryName(country) : '',
                    stations.find((item) => item.key === station)?.label,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => {
                      setTrack('');
                      setCountry('');
                      setStation('');
                    }}
                  >
                    Clear selection
                  </Button>
                </div>
              )}
            </div>
            <section className={styles.metrics} aria-label="Selected radio activity">
              {[
                ['Recorded plays', selected.length],
                ['Tracks played', topTracks.length],
                ['Stations', topStations.length],
                ['Countries', knownCountries],
              ].map(([label, value]) => (
                <Card className={styles.metric} key={label}>
                  <span>{label}</span>
                  <strong data-testid={label === 'Recorded plays' ? 'play-count' : undefined}>
                    {number(Number(value))}
                  </strong>
                </Card>
              ))}
            </section>
            {!selected.length ? (
              <div className={styles.state}>
                <h2>No plays match these filters</h2>
                <p>Try another date range, track, country or station.</p>
                <Button variant="outline" size="sm" onClick={reset}>
                  Reset filters
                </Button>
              </div>
            ) : (
              <>
                <Card className={styles.card} role="region" aria-label="Play history">
                  <div className={styles.sectionHead}>
                    <h2>Plays over time</h2>
                    <span>Recorded plays per {series.monthly ? 'month' : 'day'}</span>
                  </div>
                  <div
                    className={styles.chart}
                    role="img"
                    aria-label={`${number(selected.length)} recorded plays from ${dateLabel(start)} to ${dateLabel(end)}. Chart values are available below.`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={series.rows}
                        margin={{ top: 12, right: 8, left: -20, bottom: 4 }}
                        accessibilityLayer
                      >
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value) =>
                            new Date(value + 'T00:00:00Z').toLocaleDateString('en-GB', {
                              day: series.monthly ? undefined : 'numeric',
                              month: 'short',
                              year: series.monthly ? '2-digit' : undefined,
                              timeZone: 'UTC',
                            })
                          }
                          tickLine={false}
                          axisLine={false}
                          minTickGap={32}
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                        />
                        <Tooltip
                          labelFormatter={(value) => dateLabel(String(value))}
                          formatter={(value) => [number(Number(value)), 'Recorded plays']}
                          cursor={{ fill: 'hsl(var(--muted))' }}
                          contentStyle={{
                            background: 'hsl(var(--popover))',
                            color: 'hsl(var(--popover-foreground))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: 'var(--radius)',
                          }}
                        />
                        <Bar
                          dataKey="plays"
                          fill="hsl(var(--chart-1))"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={28}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <details className={styles.details}>
                    <summary>View chart values</summary>
                    <div className={styles.values}>
                      {series.rows.map((row) => (
                        <div key={row.date}>
                          <span>{dateLabel(row.date)}</span>
                          <strong>{row.plays}</strong>
                        </div>
                      ))}
                    </div>
                  </details>
                </Card>
                <div className={styles.rankingGrid}>
                  <Ranking title="Top tracks" rows={topTracks} onSelect={setTrack} />
                  <Ranking title="Top stations" rows={topStations} onSelect={setStation} />
                  <Ranking title="Countries" rows={topCountries} onSelect={setCountry} />
                </div>
                <Card className={styles.card} role="region" aria-label="Recent plays">
                  <div className={styles.sectionHead}>
                    <h2>Recent plays</h2>
                    <span>{number(selected.length)} in selection</span>
                  </div>
                  <div className="mb-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Track / station</TableHead>
                          <TableHead>Played at (UTC)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.slice(0, visibleCount).map((play) => (
                          <TableRow key={play.id}>
                            <TableCell>
                              <Link
                                className="inline-flex items-center gap-1 font-medium hover:underline"
                                href={`${RADIO_RECORDS}?recordId=${play.id}`}
                              >
                                {play.track}
                                <ArrowUpRight className="size-3 shrink-0" />
                              </Link>
                              <div className="text-muted-foreground mt-1 text-xs">
                                {play.station} ·{' '}
                                {[play.city, countryName(play.country)].filter(Boolean).join(', ')}
                              </div>
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              <time dateTime={play.at}>{dateLabel(play.at, true)}</time>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {visibleCount < selected.length && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setVisibleCount((value) => value + 25)}
                    >
                      Show more plays
                    </Button>
                  )}
                </Card>
              </>
            )}
            <footer className={styles.footer}>
              <p>
                Counts reflect timestamped plays supplied by Songstats, not every broadcast. Days
                without records mean no imported plays; coverage may be incomplete.{' '}
                {data?.missingDates
                  ? `${number(data.missingDates)} records without a valid play time are excluded.`
                  : ''}
              </p>
              <p>
                Station totals can cover more broadcasts than this feed.{' '}
                <Link href={RADIO_TOTALS}>Open station totals ↗</Link>
              </p>
              <details>
                <summary>Data and definitions</summary>
                <p>
                  Source: Radio Plays in Songstats — True Nature. Dashboard filters apply to all
                  cards, charts and recent plays. Each record counts as one play. Tracks and
                  stations are counted by their source IDs; countries exclude unknown locations.
                  Default periods end on the latest imported play, not today. Reload reads Tables;
                  it does not fetch new Songstats data.
                </p>
                <Link href={RADIO_RECORDS}>Inspect source records ↗</Link>
              </details>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
