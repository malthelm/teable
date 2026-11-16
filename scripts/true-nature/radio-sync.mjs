/** Hourly, append-only Songstats radio sync through Teable's permission-checked API.
 * Credentials and run journals live in a private mounted directory, never in this tree.
 * --snapshot DIR --once imports a complete authorized MCP capture using the same pipeline.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, open, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TABLES = { artists: 'tbl292tj6WqrCUB9BU1', tracks: 'tblpxYFp8SJBeKHv9sj', stations: 'tbl5CtRQM5F3dWaS9kc', trackStations: 'tblgG6FCHECWunEgpr9', plays: 'tbl1eE4aCNKI5keXnE0' };
const LABEL = '8n032k69';
const HOUR = 3600000;
const iso = () => new Date().toISOString();
const text = value => value == null ? '' : String(value);
export function playIdentity(track, station, timestamp) {
  const seconds = Number(timestamp);
  if (!track || !station || !Number.isFinite(seconds) || seconds < 0 || seconds > 4102444800) throw new Error('Invalid play identity');
  return JSON.stringify([String(track), String(station), new Date(seconds * 1000).toISOString()]);
}
export function retryAfter(value, now = Date.now()) {
  const delay = /^\d+$/.test(value || '') ? Number(value) * 1000 : Date.parse(value || '') - now;
  return Math.max(HOUR, Number.isFinite(delay) ? delay : HOUR);
}
export class SyncError extends Error {
  constructor(message, delay = HOUR) { super(message); this.delay = delay; }
}
async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
async function atomic(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await rename(tmp, path);
}
async function request(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
  catch { throw new SyncError('A data source could not be reached. The last complete update is retained.'); }
  if (response.status === 429) throw new SyncError('A data source rate limit paused the update. It will retry after the waiting period.', retryAfter(response.headers.get('retry-after')));
  if (!response.ok) throw new SyncError(`A data source rejected the update (HTTP ${response.status}). Check the saved connection and access.`);
  const data = await response.json();
  return data;
}
export function songstatsQuery(id, offset) {
  return new URLSearchParams({ songstats_label_id: LABEL, source: 'radio', limit: '100', offset: String(offset), ...(id !== 'catalog' ? { songstats_track_id: id, with_stations: 'true', with_radio_plays: 'true' } : {}) });
}
export async function capture(provider) {
  const catalog = [], responses = [];
  let expected;
  for (let offset = 0; offset < 10000; offset += 100) {
    const result = await provider('catalog', offset);
    if (result.result !== 'success' || !Array.isArray(result.catalog)) throw new SyncError('Songstats returned an incomplete catalog. No data was imported.');
    responses.push({ file: `catalog-${offset}.json`, data: result });
    catalog.push(...result.catalog);
    expected = result.total ?? result.total_tracks ?? result.tracks_total ?? expected;
    if (result.catalog.length < 100) break;
    if (offset === 9900) throw new SyncError('Catalog exceeds the sync limit. Review required.');
  }
  if (Number.isFinite(expected) && expected !== catalog.length) throw new SyncError('Catalog pagination changed. No data was imported.');
  const seenTracks = new Set(), tracks = [], coverageWarnings = [];
  for (const track of catalog) {
    const id = track.songstats_track_id;
    if (!/^[a-z0-9]+$/i.test(id || '') || seenTracks.has(id)) throw new SyncError('Catalog contains an invalid or duplicate track.');
    seenTracks.add(id);
    if (track.accessible === false || (track.accessible_source_ids && !track.accessible_source_ids.includes('radio'))) throw new SyncError('Songstats radio access is incomplete. Check the connection.');
    const stations = [], seenStations = new Set();
    let total;
    for (let offset = 0; offset < 10000; offset += 100) {
      const result = await provider(id, offset);
      const data = result.stats?.find(item => item.source === 'radio')?.data;
      if (result.result !== 'success' || !data || !Array.isArray(data.radio_stations) || !Number.isInteger(data.radio_stations_total)) throw new SyncError('Songstats returned incomplete station data. No data was imported.');
      if (total !== undefined && total !== data.radio_stations_total) throw new SyncError('Station totals changed during pagination. No data was imported.');
      total = data.radio_stations_total;
      responses.push({ file: `${id}-${offset}.json`, data: result });
      for (const station of data.radio_stations) {
        const sid = text(station.radio_station_id);
        if (!sid || seenStations.has(sid) || !Array.isArray(station.radio_plays)) throw new SyncError('Station timestamps are missing or repeated. No data was imported.');
        seenStations.add(sid);
        for (const timestamp of station.radio_plays) playIdentity(id, sid, timestamp);
        stations.push(station);
      }
      if (data.radio_stations.length < 100) break;
      if (offset === 9900) throw new SyncError('Station pagination exceeds the sync limit. No data was imported.');
    }
    if (stations.length !== total) coverageWarnings.push(`${id}: Songstats reports ${total} stations but returned ${stations.length} station details.`);
    tracks.push({ ...track, stations });
  }
  return { tracks, responses, coverageWarnings };
}
export function uniqueIndex(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = key(row.fields);
    if (!id || result.has(id)) throw new SyncError('Existing records contain missing or duplicate identities. Review required before syncing.');
    result.set(id, row);
  }
  return result;
}
function equivalent(a, b) {
  if (Array.isArray(b)) return JSON.stringify((a || []).map(v => v.id)) === JSON.stringify(b.map(v => v.id));
  if (b && typeof b === 'object' && 'id' in b) return a?.id === b.id;
  if (b === null) return a == null || a === '';
  return a === b;
}
export async function importCapture(captured, api, journal, fetchedAt) {
  const all = {};
  for (const [name, table] of Object.entries(TABLES)) all[name] = await api.records(table);
  const indices = {
    artists: uniqueIndex(all.artists, f => text(f.Record_Key)),
    tracks: uniqueIndex(all.tracks, f => text(f.Track_ID)),
    stations: uniqueIndex(all.stations, f => text(f.Station_ID)),
    trackStations: uniqueIndex(all.trackStations, f => `${f.Track_ID}:${f.Station_ID}`),
    plays: uniqueIndex(all.plays, f => playIdentity(f.Track_ID, f.Station_ID, f.Timestamp)),
  };
  let addedPlays = 0, changedRecords = 0;
  async function upsert(name, key, fields) {
    const existing = indices[name].get(key);
    const changed = Object.fromEntries(Object.entries(fields).filter(([field, value]) => !existing || !equivalent(existing.fields[field], value)));
    if (existing && !Object.keys(changed).length) return existing;
    await journal({ type: 'before', table: TABLES[name], id: existing?.id, key, fields: existing ? Object.fromEntries(Object.keys(changed).map(k => [k, existing.fields[k] ?? null])) : null });
    const record = await api.write(TABLES[name], existing?.id, changed);
    if (!record?.id) throw new SyncError('Teable did not confirm a record write.');
    await journal({ type: 'after', table: TABLES[name], id: record.id, created: !existing, key });
    const updated = { id: record.id, fields: { ...existing?.fields, ...changed } };
    indices[name].set(key, updated);
    changedRecords++;
    if (name === 'plays' && !existing) addedPlays++;
    return updated;
  }
  const expectedPlays = new Set();
  for (const track of captured.tracks) {
    const tid = track.songstats_track_id;
    const artists = [];
    for (const artist of track.artists || []) {
      const aid = artist.songstats_artist_id;
      if (!aid) continue;
      const row = await upsert('artists', aid, { Record_Key: aid, Name: artist.name, Profile_ID: aid, Profile_Type: indices.artists.get(aid)?.fields.Profile_Type || 'artist reference' });
      artists.push({ id: row.id });
    }
    const tr = await upsert('tracks', tid, {
      Record_Key: tid, Track_ID: tid, Track: track.title,
      Artists: (track.artists || []).map(a => a.name).join(', '),
      ISRCs: (track.isrcs || []).join(', '), Songstats_URL: track.site_url || null,
      Release_Date: track.release_date ? new Date(track.release_date).toISOString() : null,
      'Artist records': artists,
    });
    for (const station of track.stations) {
      const sid = text(station.radio_station_id);
      const sr = await upsert('stations', sid, {
        Record_Key: sid, Station_ID: sid, Station: station.name,
        City: station.city_name || null, Country: station.country_code || null,
        Frequency: text(station.frequency) || null, Type: station.type || null,
        Website: station.external_url || null,
        Latitude: station.city_lat ? Number(station.city_lat) : null,
        Longitude: station.city_lng ? Number(station.city_lng) : null,
      });
      const shared = { Track: track.title, Track_ID: tid, Station: station.name, Station_ID: sid, City: station.city_name || null, Country: station.country_code || null, 'Track record': { id: tr.id }, 'Station record': { id: sr.id } };
      const summary = { ...shared, Record_Key: `${tid}:${sid}`, Plays: station.radio_plays_total ?? null, First_Play: station.first_played_at ? new Date(station.first_played_at).toISOString() : null, Last_Play: station.last_played_at ? new Date(station.last_played_at).toISOString() : null };
      const oldSummary = indices.trackStations.get(summary.Record_Key);
      if (!oldSummary || Object.entries(summary).some(([k, v]) => !equivalent(oldSummary.fields[k], v))) {
        await upsert('trackStations', summary.Record_Key, { ...summary, Fetched_At: fetchedAt, Payload_JSON: JSON.stringify(station) });
      }
      for (const ts of station.radio_plays) {
        const identity = playIdentity(tid, sid, ts);
        expectedPlays.add(identity);
        // A reporting change must never erase the retained broadcast history.
        if (indices.plays.has(identity)) continue;
        const timestamp = Number(ts);
        const hash = createHash('sha256').update(JSON.stringify([tid, sid, timestamp])).digest('hex');
        await upsert('plays', identity, { ...shared, Record_Key: hash, Timestamp: timestamp, Played_At_UTC: new Date(timestamp * 1000).toISOString(), Fetched_At: fetchedAt, Source_File: `radio-sync/${tid}`, });
      }
    }
  }
  // Verify every source detection and its native links before advancing freshness.
  const verified = await api.records(TABLES.plays);
  const index = uniqueIndex(verified, f => playIdentity(f.Track_ID, f.Station_ID, f.Timestamp));
  for (const key of expectedPlays) {
    const row = index.get(key);
    if (!row || !row.fields['Track record']?.id || !row.fields['Station record']?.id) throw new SyncError('Readback could not verify all radio detections and links.');
  }
  if (verified.length !== all.plays.length + addedPlays) throw new SyncError('Radio row count changed unexpectedly during readback.');
  return { addedPlays, changedRecords, coverageWarnings: captured.coverageWarnings || [], totalPlays: verified.length, tracksChecked: captured.tracks.length, sourcePlays: expectedPlays.size, latestPlay: [...index.keys()].map(k => JSON.parse(k)[2]).sort().at(-1) || null };
}
export function teableAPI(config) {
  const base = process.env.TRUE_NATURE_TEABLE_URL || 'http://true-nature-tables:3000/api';
  const call = (path, method = 'GET', body) => request(`${base}${path}`, { method, headers: { Authorization: `Bearer ${config.teableToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return {
    async records(table) {
      const rows = [];
      for (let skip = 0; skip < 100000; skip += 1000) {
        const page = await call(`/table/${table}/record?fieldKeyType=name&take=1000&skip=${skip}&ignoreViewQuery=true`);
        if (!Array.isArray(page.records)) throw new SyncError('Teable returned incomplete records.');
        rows.push(...page.records);
        if (page.records.length < 1000) return rows;
      }
      throw new SyncError('Radio sync exceeds its record limit. Review required.');
    },
    async write(table, id, fields) {
      const result = await call(`/table/${table}/record${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', { fieldKeyType: 'name', typecast: false, ...(id ? { record: { fields } } : { records: [{ fields }] }) });
      return id ? result : result.records?.[0];
    },
  };
}
async function run(dir, config, snapshot) {
  const lock = join(dir, 'run.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  const statePath = join(dir, 'status.json');
  const state = await readJSON(statePath, {});
  const started = iso();
  await atomic(statePath, { ...state, running: true, lastAttempt: started, heartbeat: started });
  const heartbeat = setInterval(() => void atomic(statePath, { ...state, running: true, lastAttempt: started, heartbeat: iso() }).catch(() => {}), 30000);
  try {
    const runDir = join(dir, 'runs', started.replaceAll(':', '-'));
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const provider = async (id, offset) => {
      const filename = `${id === 'catalog' ? 'catalog' : id}-${offset}.json`;
      if (snapshot) return readJSON(join(snapshot, filename));
      const path = id === 'catalog' ? '/labels/catalog' : '/tracks/stats';
      const query = songstatsQuery(id, offset);
      return request(`https://api.songstats.com/enterprise/v1${path}?${query}`, { headers: { apikey: config.apiKey } });
    };
    const captured = await capture(provider);
    for (const item of captured.responses) await atomic(join(runDir, item.file), item.data);
    const fetchedAt = snapshot ? new Date((await stat(join(snapshot, 'catalog-0.json'))).mtime).toISOString() : iso();
    const journalFile = await open(join(runDir, 'journal.jsonl'), 'a', 0o600);
    let result;
    try { result = await importCapture(captured, teableAPI(config), item => journalFile.appendFile(JSON.stringify(item) + '\n'), fetchedAt); }
    finally { await journalFile.close(); }
    clearInterval(heartbeat);
    const finished = iso();
    await atomic(statePath, { ...state, ...result, running: false, lastAttempt: started, lastSuccess: finished, sourceFetchedAt: fetchedAt, heartbeat: finished, lastError: null, blockedUntil: null, nextRun: new Date(Date.now() + HOUR).toISOString(), handledRequest: config.requestedAt || null });
    await atomic(join(runDir, 'complete.json'), result);
    process.stdout.write(JSON.stringify({ event: 'complete', ...result }) + '\n');
  } catch (error) {
    clearInterval(heartbeat);
    const delay = error instanceof SyncError ? error.delay : HOUR;
    const message = error instanceof SyncError ? error.message : 'The update could not finish. Retained records are safe; check the connection and retry.';
    await atomic(statePath, { ...state, running: false, lastAttempt: started, heartbeat: iso(), lastError: message, nextRun: new Date(Date.now() + delay).toISOString(), blockedUntil: new Date(Date.now() + delay).toISOString(), handledRequest: config.requestedAt || null });
    process.stdout.write(JSON.stringify({ event: 'failed', message }) + '\n');
    if (snapshot) throw new SyncError(message);
  } finally {
    clearInterval(heartbeat); await handle.close(); await unlink(lock);
  }
}
async function main() {
  const dir = process.env.TRUE_NATURE_RADIO_SYNC_DIR;
  if (!dir) throw new Error('Missing private sync directory');
  const snapshotIndex = process.argv.indexOf('--snapshot');
  const snapshot = snapshotIndex >= 0 ? resolve(process.argv[snapshotIndex + 1]) : undefined;
  // Single Dokploy worker; after a container restart the old process cannot still own this lock.
  if (!process.argv.includes('--once')) await unlink(join(dir, 'run.lock')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  do {
    const config = await readJSON(join(dir, 'config.json'), {});
    const state = await readJSON(join(dir, 'status.json'), {});
    const requested = config.requestedAt && config.requestedAt !== state.handledRequest;
    const allowed = !state.blockedUntil || Date.now() >= Date.parse(state.blockedUntil);
    if (snapshot || (config.apiKey && config.enabled && allowed && (requested || !state.nextRun || Date.now() >= Date.parse(state.nextRun)))) await run(dir, config, snapshot);
    else await atomic(join(dir, 'status.json'), { ...state, heartbeat: iso() });
    if (process.argv.includes('--once')) break;
    await new Promise(resolve => setTimeout(resolve, 60000));
  } while (true);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('Radio sync stopped; private configuration or snapshot needs attention.\n'); process.exitCode = 1; });
}
