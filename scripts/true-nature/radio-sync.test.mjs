import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, importCapture, playIdentity, retryAfter, TABLES } from './radio-sync.mjs';

test('numeric and string timestamps have the same identity; invalid timestamps fail', () => {
  assert.equal(playIdentity('t', 's', 1790000000), playIdentity('t', 's', '1790000000'));
  assert.throws(() => playIdentity('t', 's', 'oops'));
  assert.equal(retryAfter('7200', 0), 7200000);
  assert.equal(retryAfter('5', 0), 3600000);
});
const track = { songstats_track_id: 'track1', title: 'Test', artists: [{ name: 'Artist', songstats_artist_id: 'artist1' }], stations: [{ radio_station_id: 42, name: 'Station', radio_plays: [1790000000, '1790000000'], radio_plays_total: 1 }] };
test('full pagination is required; missing timestamps never become zero plays', async () => {
  const catalog = { result: 'success', catalog: [track], tracks_total: 1 };
  const result = await capture(async id => id === 'catalog' ? catalog : { result: 'success', stats: [{ source: 'radio', data: { radio_stations_total: 2, radio_stations: track.stations } }] });
  assert.equal(result.coverageWarnings.length, 1);
  await assert.rejects(capture(async id => id === 'catalog' ? catalog : { result: 'success', stats: [{ source: 'radio', data: { radio_stations_total: 1, radio_stations: [{ radio_station_id: 42 }] } }] }), /missing/);
});
test('imports append once, retain history, link records and become no-op on repetition', async () => {
  const rows = Object.fromEntries(Object.values(TABLES).map(t => [t, []]));
  rows[TABLES.plays].push({ id: 'old', fields: { Track_ID: 'oldtrack', Station_ID: 'oldstation', Timestamp: 1700000000, 'Track record': { id: 'oldtr' }, 'Station record': { id: 'oldsr' } } });
  const journal = [];
  let writes = 0;
  const api = {
    records: async t => structuredClone(rows[t]),
    write: async (t, id, fields) => {
      writes++;
      if (id) { const r = rows[t].find(r => r.id === id); Object.assign(r.fields, fields); return r; }
      const r = { id: `r${writes}`, fields }; rows[t].push(r); return r;
    },
  };
  const first = await importCapture({ tracks: [track] }, api, async item => journal.push(item), '2026-11-16T00:00:00.000Z');
  assert.equal(first.addedPlays, 1);
  assert.equal(first.totalPlays, 2);
  assert.equal(first.sourcePlays, 1);
  assert.equal(journal.filter(j => j.type === 'before').length, writes);
  const second = await importCapture({ tracks: [track] }, api, async item => journal.push(item), '2026-11-17T00:00:00.000Z');
  assert.equal(second.addedPlays, 0);
  assert.equal(second.changedRecords, 0);
  assert.equal(rows[TABLES.plays][1].fields.Fetched_At, '2026-11-16T00:00:00.000Z');
});
test('duplicate existing identities stop before mutations', async () => {
  const duplicate = { id: 'a', fields: { Record_Key: 'same' } };
  let writes = 0;
  const api = { records: async t => t === TABLES.artists ? [duplicate, { ...duplicate, id: 'b' }] : [], write: async () => writes++ };
  await assert.rejects(importCapture({ tracks: [] }, api, async () => {}, new Date().toISOString()), /duplicate/);
  assert.equal(writes, 0);
});
