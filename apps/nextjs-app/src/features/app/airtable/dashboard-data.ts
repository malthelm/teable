import { RADIO_BASE } from '../radio/radio-data';
import config from './import-config.json';

export type Dashboard = 'funding' | 'catalog' | 'contacts';
export interface Row {
  id: string;
  fields: Record<string, unknown>;
}
export const text = (r: Row, key: string) =>
  typeof r.fields[key] === 'string' ? (r.fields[key] as string) : '';
export const settings = {
  funding: {
    title: 'Funding',
    key: 'funding',
    dimension: 'Status',
    columns: ['Name', 'Project', 'Status', 'Stage', 'Deadline', 'Next action due', 'Next action'],
    note: 'Grant Applications · Airtable statuses may differ from Label Suite. Check the current application before acting on an old deadline.',
  },
  catalog: {
    title: 'Catalog readiness',
    key: 'masters',
    dimension: 'Metadata',
    columns: ['Name', 'ISRC', 'Audio linked', 'Source readiness'],
    note: 'Label Suite v3 · Airtable recordings, including collaborators and unnamed records. Current release delivery is in the Releases workspace.',
  },
  contacts: {
    title: 'Radio contacts',
    key: 'stations',
    dimension: 'Country',
    columns: ['Name', 'Country', 'City', 'State', 'Type', 'Support', 'Email recorded'],
    note: 'Label Suite v3 · Outreach directory, not confirmed plays. City and state values are preserved as entered; some appear reversed. Campaign Stations has no records in this import.',
  },
} as const;
export function tableFor(view: Dashboard) {
  return config.tables[settings[view].key];
}
export function recordUrl(view: Dashboard, id?: string) {
  const table = tableFor(view);
  return `/base/${RADIO_BASE}/table/${table.tableId}/${table.viewId}${id ? `?recordId=${id}` : ''}`;
}
export function filterRows(
  rows: Row[],
  view: Dashboard,
  search: string,
  group: string,
  attention: boolean
) {
  const q = search.toLocaleLowerCase().trim();
  return rows.filter(
    (r) =>
      (!q || settings[view].columns.some((k) => text(r, k).toLocaleLowerCase().includes(q))) &&
      (!group || (text(r, settings[view].dimension) || 'Not set') === group) &&
      (!attention ||
        (view === 'catalog'
          ? !text(r, 'ISRC') || text(r, 'Audio linked') !== 'Yes'
          : view === 'contacts'
            ? !text(r, 'Email')
            : !text(r, 'Next action')))
  );
}
export function groups(rows: Row[], field: string) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = text(r, field) || 'Not set';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export function metrics(rows: Row[], view: Dashboard) {
  if (view === 'catalog')
    return [
      ['Recordings', rows.length],
      ['Missing ISRC', rows.filter((r) => !text(r, 'ISRC')).length],
      ['No audio link', rows.filter((r) => text(r, 'Audio linked') !== 'Yes').length],
      ['No artist linked', rows.filter((r) => !text(r, 'Artist')).length],
    ] as const;
  if (view === 'contacts')
    return [
      ['Station records', rows.length],
      ['Countries recorded', new Set(rows.map((r) => text(r, 'Country')).filter(Boolean)).size],
      ['Email recorded', rows.filter((r) => !!text(r, 'Email')).length],
      ['No email recorded', rows.filter((r) => !text(r, 'Email')).length],
    ] as const;
  return [
    ['Applications', rows.length],
    ['Submitted status', rows.filter((r) => text(r, 'Status') === 'Submitted').length],
    ['Approved status', rows.filter((r) => text(r, 'Status') === 'Approved').length],
    ['No next action', rows.filter((r) => !text(r, 'Next action')).length],
  ] as const;
}
export async function loadRows(view: Dashboard, signal: AbortSignal): Promise<Row[]> {
  const rows: Row[] = [];
  for (let skip = 0; skip < 100000; skip += 1000) {
    const response = await fetch(
      `/api/table/${tableFor(view).tableId}/record?fieldKeyType=name&take=1000&skip=${skip}`,
      { signal, cache: 'no-store' }
    );
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Sign in with an account that can read this base.'
          : 'The imported records could not be loaded.'
      );
    const data = await response.json();
    if (!Array.isArray(data.records))
      throw new Error('The server returned an unexpected response.');
    rows.push(
      ...data.records.map((r: Row) => ({ ...r, fields: { ...r.fields, Metadata: metadata(r) } }))
    );
    if (data.records.length < 1000) {
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new Error('Records changed while loading. Reload to get complete totals.');
      return rows;
    }
  }
  throw new Error('The query limit was reached. No partial totals are shown.');
}
export const importedAt = config.importedAt;

export function metadata(r: Row) {
  const isrc = !!text(r, 'ISRC');
  const audio = text(r, 'Audio linked') === 'Yes';
  if (isrc && audio) return 'ISRC and audio linked';
  if (isrc) return 'ISRC only';
  return audio ? 'Audio link only' : 'Neither recorded';
}
