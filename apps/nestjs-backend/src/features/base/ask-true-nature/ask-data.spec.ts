/* eslint-disable teable/naming-convention -- External protocol and source field names. */
import { describe, expect, it } from 'vitest';
import { radioQuery, summarizeRadio, summarizeReleases } from './ask-data';
import { readSse } from './codex-provider';

const record = (id: string, date: string, track = 'Track One') => ({
  id,
  fields: {
    Track: track,
    Station: 'Radio North',
    Country: 'Denmark',
    Played_At_UTC: date,
    Fetched_At: '2026-11-11T12:00:00Z',
  },
});
describe('Ask True Nature evidence', () => {
  it('treats provider empty date filters as omitted rather than rejecting an all-time query', () => {
    const query = radioQuery.parse({ track: '', station: '', country: '', start: '', end: '' });
    expect(summarizeRadio([record('a', '2026-11-10T12:00:00Z')], query).data.matchingPlays).toBe(1);
  });
  it('counts all matching rows while bounding samples and identifying stale coverage', () => {
    const rows = Array.from({ length: 25 }, (_, i) => record(`rec${i}`, '2026-11-10T23:00:00Z'));
    const { data, sources } = summarizeRadio(
      rows,
      radioQuery.parse({ country: 'den', start: '2026-11-10', end: '2026-11-10' })
    );
    expect(data.matchingPlays).toBe(25);
    expect(data.latestMatchingPlays).toHaveLength(20);
    expect(data.tracks[0].count).toBe(25);
    expect(sources).toHaveLength(7);
    expect(data.snapshotFetchedAt).toBe('2026-11-11T12:00:00Z');
    expect(summarizeRadio(rows, { start: '2026-11-16' }).data.matchingPlays).toBe(0);
  });
  it('uses UTC inclusive dates and exposes invalid dates without inventing plays', () => {
    const { data } = summarizeRadio(
      [record('a', '2026-11-11T00:30:00+02:00'), record('b', ''), record('c', 'bad')],
      { end: '2026-11-10' }
    );
    expect(data.matchingPlays).toBe(1);
    expect(data.missingDates).toBe(2);
    expect(data.latestMatchingPlays[0].at).toBe('2026-11-10T22:30:00.000Z');
  });
  it('rejects duplicates, reversed dates, unknown query keys and invalid dates', () => {
    expect(() => summarizeRadio([record('a', ''), record('a', '')], {})).toThrow();
    expect(radioQuery.safeParse({ start: '2026-11-20', end: '2026-11-10' }).success).toBe(false);
    expect(radioQuery.safeParse({ sql: 'select *' }).success).toBe(false);
    expect(radioQuery.safeParse({ start: '2026-13-01' }).success).toBe(false);
  });
  it('preserves unknown readiness and restricts tracks to the selected release', () => {
    const { data, sources } = summarizeReleases(
      {
        releases: [
          { id: 'r1', title: 'Real', artist: 'Blue', release_ready: null },
          { id: 'r2', title: 'QA — test' },
        ],
        tracks: [
          { id: 't1', release_id: 'r1', isrc: null },
          { id: 't2', release_id: 'r2' },
        ],
        milestones: [],
        refreshedAt: 'now',
        sourceOrigin: 'https://suite.truenature.online',
      },
      { search: 'blue' }
    );
    expect(data.matchingReleases).toBe(1);
    expect(data.releases[0].tracks).toHaveLength(1);
    expect(sources[1].detail).toContain('not assessed');
    expect(sources[1].href).toBe('https://suite.truenature.online/releases/r1');
  });
  it('frames split UTF-8, CRLF and multiple SSE events correctly', async () => {
    const bytes = new TextEncoder().encode(
      ': ping\r\n\r\ndata: {"text":"blå"}\r\n\r\ndata: {"n":2}\n\n'
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    const events = [];
    for await (const event of readSse(stream)) events.push(event);
    expect(events).toEqual([{ text: 'blå' }, { n: 2 }]);
  });
});
