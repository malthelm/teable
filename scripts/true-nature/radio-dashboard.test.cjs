const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizePlays, filterPlays, rankPlays, timeline, dateWindow, loadPlays } = require('../../apps/nextjs-app/src/features/app/radio/radio-data.ts');
const record = (id, at, track = 'a', country = 'US') => ({id, fields: {Track:track, Track_ID:track, Station:'Station', Station_ID:'s', Country:country, Played_At_UTC:at}});

test('UTC normalization, missing dates and duplicate record protection', () => {
  const result = normalizePlays([record('1','2026-11-11T23:30:00-05:00'),record('2','invalid')]);
  assert.equal(result.plays[0].day,'2026-11-12');
  assert.equal(result.missingDates,1);
  assert.throws(() => normalizePlays([record('1','2026-11-11'),record('1','2026-11-11')]));
});
test('inclusive date windows and intersecting dimensions reconcile', () => {
  assert.equal(dateWindow('2026-11-11',30),'2026-10-13');
  const {plays} = normalizePlays([record('1','2026-10-12','a'),record('2','2026-10-13','a'),record('3','2026-11-11','b'),record('4','2026-11-11','a','')]);
  const selected = filterPlays(plays,{start:'2026-10-13',end:'2026-11-11',track:'a',country:'unknown',station:'s'});
  assert.deepEqual(selected.map(p=>p.id),['4']);
  for(const dimension of ['track','station','country']) assert.equal(rankPlays(plays,dimension).reduce((n,r)=>n+r.count,0),plays.length);
});
test('timeline preserves empty days and reconciles monthly buckets across years', () => {
  const {plays}=normalizePlays([record('1','2025-12-31'),record('2','2026-01-02')]);
  const daily=timeline(plays,'2025-12-31','2026-01-02');
  assert.deepEqual(daily.rows.map(r=>r.plays),[1,0,1]);
  const monthly=timeline(plays,'2025-10-12','2026-11-11');
  assert.equal(monthly.monthly,true);
  assert.equal(monthly.rows.reduce((n,r)=>n+r.plays,0),2);
  assert.deepEqual(timeline(plays,'2026-11-11','2026-01-01').rows,[]);
});
test('loading paginates and rejects an incomplete fetch rather than showing partial totals', async () => {
  const original=global.fetch;let calls=0;
  try {
    global.fetch=async url=>{calls++;return {ok:true,json:async()=>({records:calls===1 ? Array.from({length:1000},(_,i)=>record(String(i),'2026-11-11')) : [record('last','2026-11-10')]})};};
    assert.equal((await loadPlays(new AbortController().signal)).plays.length,1001);
    assert.equal(calls,2);
    calls=0;global.fetch=async()=>++calls===1 ? {ok:true,json:async()=>({records:Array.from({length:1000},(_,i)=>record(String(i),'2026-11-11'))})} : {ok:false,status:503};
    await assert.rejects(loadPlays(new AbortController().signal),/could not be loaded/);
  } finally {global.fetch=original;}
});
