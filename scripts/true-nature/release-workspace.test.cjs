const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('../../apps/nextjs-app/node_modules/typescript');
const filename = path.resolve(__dirname, '../../apps/nextjs-app/src/features/app/releases/release-data.ts');
const m = new Module(filename, module);
m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = m.require.bind(m);
m.require = id => id === '../radio/radio-data' ? originalRequire(id + '.ts') : originalRequire(id);
m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
const {matchRadio, defaultRelease, isTestRelease} = m.exports;
test('release selection chooses the nearest upcoming date and flags explicit QA labels',()=>{
 const releases=[{id:'past',title:'Album',release_date:'2026-01-01'},{id:'later',release_date:'2027-01-01'},{id:'next',release_date:'2026-12-04'}];
 assert.equal(defaultRelease(releases,'2026-11-16'),'next');
 assert.equal(defaultRelease([],'2026-11-16'),'');
 assert.equal(isTestRelease({title:'QA — fixture'}),true);
 assert.equal(isTestRelease({title:'Equal Parts'}),false);
});
test('exact ISRC joins exclude ambiguous and missing matches without duplicating plays',()=>{
 const catalog=[{id:'a',fields:{Track_ID:'s1',ISRCs:'DKABC2600001, DKABC2600002'}},{id:'b',fields:{Track_ID:'s2',ISRCs:'DKABC2600002'}}];
 const tracks=[{isrc:'dk-abc-26-00001'},{isrc:'DKABC2600001'},{isrc:'DKABC2600002'},{isrc:null}];
 const result=matchRadio(tracks,catalog,[{id:'p1',trackId:'s1'},{id:'p2',trackId:'s2'}]);
 assert.equal(result.matched,2); assert.equal(result.ambiguous,1);
 assert.deepEqual(result.plays.map(p=>p.id),['p1']);
 assert.deepEqual(matchRadio([{isrc:null}],catalog,[{trackId:'s1'}]).plays,[]);
});
