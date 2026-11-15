export const RADIO_BASE = 'bsewefS0g8rtQDeFtbt';
export const RADIO_LOGIN = '/auth/login?redirect=%2Fradio';
export const RADIO_TABLE = 'tbl1eE4aCNKI5keXnE0';
export const RADIO_VIEW = 'viwCfamd2VswQTgkq5Z';
export const RADIO_RECORDS = `/base/${RADIO_BASE}/table/${RADIO_TABLE}/${RADIO_VIEW}`;
export const RADIO_TOTALS = `/base/${RADIO_BASE}/table/tblgG6FCHECWunEgpr9/viwG0tJg4Pp8Gu6IJkz`;
export const RADIO_FIELDS = [
  'Track',
  'Track_ID',
  'Station',
  'Station_ID',
  'Played_At_UTC',
  'Country',
  'City',
  'Fetched_At',
];

export interface RadioRecord {
  id: string;
  fields: Record<string, unknown>;
}
export interface Play {
  id: string;
  track: string;
  trackId: string;
  station: string;
  stationId: string;
  country: string;
  city: string;
  at: string;
  day: string;
  fetched: string;
}
export interface Filters {
  start: string;
  end: string;
  track: string;
  country: string;
  station: string;
}
export interface Rank {
  key: string;
  label: string;
  count: number;
}

export function normalizePlays(records: RadioRecord[]) {
  const plays: Play[] = [];
  let missingDates = 0;
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error('The records changed while loading. Please reload.');
    seen.add(record.id);
    const f = record.fields;
    const str = (key: string) => (typeof f[key] === 'string' ? (f[key] as string) : '');
    const date = new Date(str('Played_At_UTC'));
    if (!Number.isFinite(date.getTime())) {
      missingDates++;
      continue;
    }
    const at = date.toISOString();
    plays.push({
      id: record.id,
      track: str('Track') || 'Unknown track',
      trackId: str('Track_ID'),
      station: str('Station') || 'Unknown station',
      stationId: str('Station_ID'),
      country: str('Country'),
      city: str('City'),
      at,
      day: at.slice(0, 10),
      fetched: str('Fetched_At'),
    });
  }
  plays.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { plays, missingDates };
}

export function dateWindow(end: string, days: number) {
  if (!end) return '';
  const date = new Date(end + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

export function filterPlays(plays: Play[], filter: Filters) {
  return plays.filter(
    (p) =>
      (!filter.start || p.day >= filter.start) &&
      (!filter.end || p.day <= filter.end) &&
      (!filter.track || (p.trackId || 'unknown') === filter.track) &&
      (!filter.country || (p.country || 'unknown') === filter.country) &&
      (!filter.station || (p.stationId || 'unknown') === filter.station)
  );
}

export function rankPlays(plays: Play[], dimension: 'track' | 'station' | 'country'): Rank[] {
  const groups = new Map<string, Rank>();
  for (const play of plays) {
    const key =
      (dimension === 'track'
        ? play.trackId
        : dimension === 'station'
          ? play.stationId
          : play.country) || 'unknown';
    const label = dimension === 'country' ? countryName(play.country) : play[dimension];
    const current = groups.get(key) || { key, label, count: 0 };
    current.count++;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function countryName(code: string) {
  if (!code || code === 'unknown') return 'Unknown country';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

export function timeline(plays: Play[], start: string, end: string) {
  if (!start || !end || start > end)
    return { monthly: false, rows: [] as { date: string; plays: number }[] };
  const first = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  const monthly = (last.getTime() - first.getTime()) / 86400000 > 120;
  const groups = new Map<string, number>();
  for (const play of plays) {
    const key = monthly ? play.day.slice(0, 7) + '-01' : play.day;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  if (monthly) first.setUTCDate(1);
  const rows: { date: string; plays: number }[] = [];
  // Bound malformed/custom ranges instead of blocking a phone on an unbounded date loop.
  for (let n = 0; first <= last && n < 2400; n++) {
    const date = first.toISOString().slice(0, 10);
    rows.push({ date, plays: groups.get(date) || 0 });
    if (monthly) first.setUTCMonth(first.getUTCMonth() + 1);
    else first.setUTCDate(first.getUTCDate() + 1);
  }
  return { monthly, rows };
}

export async function loadPlays(signal: AbortSignal) {
  const records: RadioRecord[] = [];
  for (let skip = 0; skip < 100000; skip += 1000) {
    const query = new URLSearchParams({ take: '1000', skip: String(skip), fieldKeyType: 'name' });
    RADIO_FIELDS.forEach((field) => query.append('projection[]', field));
    const response = await fetch(`/api/table/${RADIO_TABLE}/record?${query}`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Your session expired or you do not have access. Sign in again to load the dashboard.'
          : 'The radio data could not be loaded. Please try again.'
      );
    const page = await response.json();
    if (!Array.isArray(page.records))
      throw new Error('The server returned an unexpected response.');
    records.push(...page.records);
    if (page.records.length < 1000) return normalizePlays(records);
  }
  throw new Error(
    'This radio library needs a larger dashboard query. No partial totals are shown.'
  );
}
