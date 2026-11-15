import { Button } from '@teable/ui-lib/shadcn';
import { ArrowUpRight, Radio, RefreshCw, Table2 } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
} from './radio-data';
import type { Play, Rank } from './radio-data';
import styles from './radio.module.css';

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
    <section className={styles.card} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        <span>Recorded plays</span>
      </div>
      {shown.length ? (
        <ol className={styles.ranking}>
          {shown.map((row) => (
            <li key={row.key}>
              <button
                onClick={() => onSelect(row.key)}
                aria-label={`Filter to ${row.label}, ${number(row.count)} plays`}
              >
                <span className={styles.rankLabel}>{row.label}</span>
                <strong>{number(row.count)}</strong>
                <span className={styles.barTrack} aria-hidden="true">
                  <span style={{ width: `${(row.count / shown[0].count) * 100}%` }} />
                </span>
              </button>
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
    </section>
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
        <title>Radio · True Nature</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <header className={styles.header}>
        <Link href="/radio" className={styles.brand}>
          <Radio size={24} aria-hidden="true" />
          True Nature <span>Radio</span>
        </Link>
        <nav aria-label="App">
          <Button variant="outline" asChild>
            <Link href={RADIO_RECORDS}>
              <Table2 size={16} />
              Tables
            </Link>
          </Button>
        </nav>
      </header>
      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <h1>Radio dashboard</h1>
            <p className={styles.muted}>What played, where, and when.</p>
          </div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRevision((r) => r + 1)}
            title="Reload the imported records from Tables"
          >
            <RefreshCw size={16} />
            Reload data
          </Button>
        </div>
        {loading ? (
          <div role="status" className={styles.state}>
            Loading your radio plays…
          </div>
        ) : error ? (
          <div role="alert" className={styles.state}>
            <h2>Couldn’t load the dashboard</h2>
            <p>{error}</p>
            <Button onClick={() => setRevision((r) => r + 1)}>Try again</Button>
            <Link href="/auth/signin?redirect=%2Fradio">Sign in</Link>
          </div>
        ) : !all.length ? (
          <div className={styles.state}>No timestamped radio plays are available yet.</div>
        ) : (
          <>
            <div className={styles.freshness}>
              <span>
                Songstats imported <strong>{dateLabel(imported)}</strong> · latest play{' '}
                {dateLabel(latestDay)}
              </span>
              <span>Automatic Songstats sync is off</span>
            </div>
            <section className={styles.filters} aria-label="Filter radio plays">
              <label>
                Period
                <select
                  value={period}
                  onChange={(e) => {
                    setPeriod(e.target.value);
                    if (e.target.value === 'custom') {
                      setCustomStart(start);
                      setCustomEnd(end);
                    }
                  }}
                >
                  <option value="30">Latest available 30 days</option>
                  <option value="90">Latest available 90 days</option>
                  <option value="all">All imported plays</option>
                  <option value="custom">Custom dates</option>
                </select>
              </label>
              <label>
                Track
                <select value={track} onChange={(e) => setTrack(e.target.value)}>
                  <option value="">All tracks</option>
                  {tracks.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Country
                <select value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">All countries</option>
                  {countries.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Station
                <select value={station} onChange={(e) => setStation(e.target.value)}>
                  <option value="">All stations</option>
                  {stations.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {period === 'custom' && (
                <>
                  <label>
                    From (UTC)
                    <input
                      type="date"
                      value={customStart}
                      min={firstDay}
                      max={latestDay}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </label>
                  <label>
                    Through (UTC)
                    <input
                      type="date"
                      value={customEnd}
                      min={firstDay}
                      max={latestDay}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </label>
                </>
              )}
              <Button variant="ghost" onClick={reset}>
                Reset filters
              </Button>
            </section>
            <div className={styles.scope} aria-live="polite">
              {invalidRange
                ? 'Choose a start date on or before the end date.'
                : `${dateLabel(start)} – ${dateLabel(end)} · all times UTC`}
            </div>
            <section className={styles.metrics} aria-label="Selected radio activity">
              {[
                ['Recorded plays', selected.length],
                ['Tracks played', topTracks.length],
                ['Stations', topStations.length],
                ['Countries', knownCountries],
              ].map(([label, value]) => (
                <div className={styles.metric} key={label}>
                  <span>{label}</span>
                  <strong data-testid={label === 'Recorded plays' ? 'play-count' : undefined}>
                    {number(Number(value))}
                  </strong>
                </div>
              ))}
            </section>
            {!selected.length ? (
              <section className={styles.state}>
                <h2>No plays match these filters</h2>
                <p>Try another date range, track, country or station.</p>
                <Button variant="outline" onClick={reset}>
                  Reset filters
                </Button>
              </section>
            ) : (
              <>
                <section className={styles.card} aria-label="Play history">
                  <div className={styles.sectionHead}>
                    <h2>Plays over time</h2>
                    <span>Recorded plays per {series.monthly ? 'month' : 'day'}</span>
                  </div>
                  <div
                    className={styles.chart}
                    role="img"
                    aria-label={`${number(selected.length)} recorded plays from ${dateLabel(start)} to ${dateLabel(end)}. Daily or monthly values are available below.`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={series.rows}
                        margin={{ top: 12, right: 8, left: -20, bottom: 4 }}
                        accessibilityLayer
                      >
                        <CartesianGrid vertical={false} stroke="#e4e9e7" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v) =>
                            new Date(v + 'T00:00:00Z').toLocaleDateString('en-GB', {
                              day: series.monthly ? undefined : 'numeric',
                              month: 'short',
                              year: series.monthly ? '2-digit' : undefined,
                              timeZone: 'UTC',
                            })
                          }
                          tickLine={false}
                          axisLine={false}
                          minTickGap={32}
                          tick={{ fontSize: 12, fill: '#63736a' }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 12, fill: '#63736a' }}
                        />
                        <Tooltip
                          labelFormatter={(v) => dateLabel(String(v))}
                          formatter={(value) => [number(Number(value)), 'Recorded plays']}
                          cursor={{ fill: '#edf3ef' }}
                        />
                        <Bar
                          dataKey="plays"
                          fill="#237450"
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
                </section>
                <div className={styles.rankingGrid}>
                  <Ranking title="Top tracks" rows={topTracks} onSelect={setTrack} />
                  <Ranking title="Top stations" rows={topStations} onSelect={setStation} />
                  <Ranking title="Countries" rows={topCountries} onSelect={setCountry} />
                </div>
                <section className={styles.card} aria-label="Recent plays">
                  <div className={styles.sectionHead}>
                    <h2>Recent plays</h2>
                    <span>{number(selected.length)} in selection</span>
                  </div>
                  <ol className={styles.feed}>
                    {selected.slice(0, visibleCount).map((play) => (
                      <li key={play.id}>
                        <Link href={`${RADIO_RECORDS}?recordId=${play.id}`}>
                          <div>
                            <strong>{play.track}</strong>
                            <span>
                              {play.station} ·{' '}
                              {[play.city, countryName(play.country)].filter(Boolean).join(', ')}
                            </span>
                          </div>
                          <time dateTime={play.at}>{dateLabel(play.at, true)} UTC</time>
                          <ArrowUpRight size={17} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                  {visibleCount < selected.length && (
                    <Button variant="outline" onClick={() => setVisibleCount((n) => n + 25)}>
                      Show more plays
                    </Button>
                  )}
                </section>
              </>
            )}
            <footer className={styles.footer}>
              <p>
                Counts reflect timestamped plays supplied by Songstats, not every broadcast. Days
                with no records mean no imported plays; coverage may be incomplete.{' '}
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
                  Source: Radio Plays in Songstats — True Nature. Filters apply to all cards, charts
                  and recent plays. Each record counts as one play. Tracks and stations are counted
                  by their source IDs; countries exclude unknown locations. Default periods end on
                  the latest imported play, not today. Reload data reads Tables; it does not fetch
                  new Songstats data.
                </p>
                <Link href={RADIO_RECORDS}>Inspect source records ↗</Link>
              </details>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
