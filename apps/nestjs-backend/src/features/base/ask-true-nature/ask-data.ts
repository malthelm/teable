import { z } from 'zod';

export const ASK_BASE = 'bsewefS0g8rtQDeFtbt';
export const RADIO_TABLE = 'tbl1eE4aCNKI5keXnE0';
export const RADIO_PATH = `/base/${ASK_BASE}/table/${RADIO_TABLE}/viwCfamd2VswQTgkq5Z`;
export interface ISourceCard {
  id: string;
  title: string;
  href: string;
  detail: string;
}
export const radioQuery = z
  .object({
    track: z.string().max(120).optional(),
    station: z.string().max(120).optional(),
    country: z.string().max(100).optional(),
    start: z.preprocess((v) => (v === '' ? undefined : v), z.string().date().optional()),
    end: z.preprocess((v) => (v === '' ? undefined : v), z.string().date().optional()),
  })
  .strict()
  .refine((q) => !q.start || !q.end || q.start <= q.end, 'Start must precede end');
export const releaseQuery = z.object({ search: z.string().max(120).optional() }).strict();
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const includes = (v: string, q?: string) =>
  !q || v.toLocaleLowerCase().includes(q.toLocaleLowerCase());
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (value: string) => {
  const code = value.toUpperCase() === 'USA' ? 'US' : value.toUpperCase() === 'UK' ? 'GB' : value;
  return /^[a-z]{2}$/i.test(code) ? countryNames.of(code.toUpperCase()) || value : value;
};
const countryMatches = (value: string, query?: string) =>
  !query ||
  includes(value, query) ||
  includes(countryName(value), query) ||
  includes(countryName(value), countryName(query));
export function summarizeRadio(
  records: { id: string; fields: Record<string, unknown> }[],
  query: z.infer<typeof radioQuery>,
  sync?: {
    enabled: boolean;
    lastSuccess: string | null;
    lastError: string | null;
    running: boolean;
  }
) {
  const seen = new Set<string>();
  const all = records.map((r) => {
    if (seen.has(r.id)) throw new Error('Radio data changed while reading; retry.');
    seen.add(r.id);
    const f = r.fields;
    const raw = str(f.Played_At_UTC);
    const at = raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : '';
    return {
      id: r.id,
      track: str(f.Track),
      station: str(f.Station),
      country: str(f.Country),
      at,
      fetched: str(f.Fetched_At),
    };
  });
  const valid = all.filter((p) => p.at).sort((a, b) => b.at.localeCompare(a.at));
  const plays = valid.filter(
    (p) =>
      includes(p.track, query.track) &&
      includes(p.station, query.station) &&
      countryMatches(p.country, query.country) &&
      (!query.start || p.at.slice(0, 10) >= query.start) &&
      (!query.end || p.at.slice(0, 10) <= query.end)
  );
  const rank = (key: 'track' | 'station' | 'country') => {
    const counts = new Map<string, number>();
    for (const p of plays)
      counts.set(p[key] || 'Unknown', (counts.get(p[key] || 'Unknown') || 0) + 1);
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 15);
  };
  const fetchedAt =
    all
      .map((p) => p.fetched)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  const data = {
    source: 'Songstats radio detections stored in Teable. Coverage depends on Songstats reporting.',
    sync: sync || { enabled: false, lastSuccess: null },
    timezone: 'UTC',
    filters: query,
    snapshotFetchedAt: fetchedAt,
    earliestPlay: valid.at(-1)?.at ?? null,
    latestPlay: valid[0]?.at ?? null,
    totalImportedRows: all.length,
    missingDates: all.length - valid.length,
    matchingPlays: plays.length,
    tracks: rank('track'),
    stations: rank('station'),
    countries: rank('country'),
    latestMatchingPlays: plays.slice(0, 20),
    latestMatchingLimit: 20,
    caveat:
      'Coverage is limited to imported detections. Zero matches does not prove zero airplay. These are not royalties or earnings.',
  };
  const sources: ISourceCard[] = [
    {
      id: 'radio',
      title: 'Songstats radio plays',
      href: `/base/${ASK_BASE}/radio`,
      detail: `${plays.length} matching plays · ${all.length} imported rows · fetched ${sync?.lastSuccess || fetchedAt || 'unknown'}. ${sync?.enabled ? 'Hourly sync enabled' : 'Automatic sync off'}${sync?.running ? '; update in progress' : ''}${sync?.lastError ? '; last update failed' : ''}; UTC.`,
    },
    ...plays.slice(0, 6).map((p) => ({
      id: p.id,
      title: p.track || 'Radio play',
      href: `${RADIO_PATH}?recordId=${encodeURIComponent(p.id)}`,
      detail: `${p.station} · ${p.country || 'Unknown country'} · ${p.at}`,
    })),
  ];
  return { data, sources };
}

type Row = Record<string, unknown>;
export function summarizeReleases(
  workspace: {
    releases: Row[];
    tracks: Row[];
    milestones: Row[];
    refreshedAt: string;
    sourceOrigin: string;
  },
  query: z.infer<typeof releaseQuery>
) {
  const releases = workspace.releases
    .filter((r) => !/^QA\s*[—–-]/i.test(str(r.title)))
    .filter((r) => includes(`${str(r.title)} ${str(r.artist)}`, query.search));
  const data = {
    source: 'Live Label Suite',
    refreshedAt: workspace.refreshedAt,
    matchingReleases: releases.length,
    excluded: 'Explicit QA test releases',
    caveat:
      'Readiness flags and missing lists are source-reported. An audio link is not verification of master quality. Missing ISRC in this database does not prove no registration exists.',
    releases: releases.map((r) => ({
      ...r,
      tracks: workspace.tracks.filter((t) => t.release_id === r.id),
      milestones: workspace.milestones.filter((m) => m.release_id === r.id),
    })),
  };
  const sources: ISourceCard[] = [
    {
      id: 'releases',
      title: 'Release workspace',
      href: `/base/${ASK_BASE}/releases`,
      detail: `${releases.length} matching releases · checked ${workspace.refreshedAt}`,
    },
    ...releases.slice(0, 12).map((r) => ({
      id: str(r.id),
      title: str(r.title),
      href: `${workspace.sourceOrigin}/releases/${encodeURIComponent(str(r.id))}`,
      detail: `${str(r.artist)} · ${str(r.release_date) || 'No release date'} · readiness ${r.release_ready === true ? 'ready' : r.release_ready === false ? 'not ready' : 'not assessed'}`,
    })),
  ];
  return { data, sources };
}

export const ASK_TOOLS = [
  {
    type: 'function',
    name: 'radio_plays',
    description:
      'Count and rank imported radio detections by track, station and country, with 20 most recent matching plays. Dates use UTC YYYY-MM-DD, inclusive. Omit filters for all imported data. Last week/month means calendar dates relative to TODAY, never the last available data window. Matching is case-insensitive substring; country accepts English names or ISO country codes.',
    parameters: {
      type: 'object',
      properties: {
        track: { type: 'string' },
        station: { type: 'string' },
        country: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'release_readiness',
    description:
      'Read live release readiness, tracks, missing metadata, dates, audio presence and milestones. Optional search matches release title or artist. QA test releases excluded.',
    parameters: {
      type: 'object',
      properties: { search: { type: 'string' } },
      additionalProperties: false,
    },
  },
];
