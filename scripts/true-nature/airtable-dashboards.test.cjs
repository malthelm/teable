const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const Module=require('node:module');
const path=require('node:path');
const ts=require('../../apps/nextjs-app/node_modules/typescript');
const filename=path.resolve(__dirname,'../../apps/nextjs-app/src/features/app/airtable/dashboard-data.ts');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
const original=m.require.bind(m);m.require=id=>id==='../radio/radio-data'?original(id+'.ts'):original(id);
m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {filterRows,groups,metrics,metadata,loadRows}=m.exports;
test('intersect search, category and missing-data filters without treating blanks as zero',()=>{
 const rows=[{id:'a',fields:{Name:'Alpha',Country:'US',Email:'contact@example.com'}},{id:'b',fields:{Name:'Alpha college',Country:'US'}},{id:'c',fields:{Name:'Alpha EU',Country:'Denmark'}}];
 assert.deepEqual(filterRows(rows,'contacts','ALPHA','US',true).map(r=>r.id),['b']);
 assert.deepEqual(metrics(filterRows(rows,'contacts','','',true),'contacts').map(m=>m[1]),[2,2,0,2]);
 assert.equal(groups([{id:'x',fields:{}}],'Status')[0].name,'Not set');
});
test('identifier and audio coverage does not imply clearance or source readiness',()=>{
 assert.equal(metadata({fields:{ISRC:'DKABC2600001','Audio linked':'Yes'}}),'ISRC and audio linked');
 assert.equal(metadata({fields:{ISRC:'DKABC2600001','Audio linked':'No'}}),'ISRC only');
 assert.equal(metadata({fields:{'Audio linked':'Yes'}}),'Audio link only');
 assert.equal(metadata({fields:{}}),'Neither recorded');
 const rows=[{id:'a',fields:{Status:'Approved',Stage:'Submitted'}},{id:'b',fields:{Status:'Submitted',Stage:'Approved'}}];
 assert.deepEqual(metrics(rows,'funding').map(m=>m[1]),[2,1,1,2]);
});
test('loader reads every page and refuses duplicate or unauthorized partial data',async()=>{
 const originalFetch=global.fetch;let calls=0;
 try {
  global.fetch=async()=>({ok:true,json:async()=>({records:++calls===1?Array.from({length:1000},(_,i)=>({id:String(i),fields:{}})):[{id:'last',fields:{}}]})});
  assert.equal((await loadRows('contacts',new AbortController().signal)).length,1001);assert.equal(calls,2);
  calls=0;global.fetch=async()=>({ok:true,json:async()=>({records:++calls===1?Array.from({length:1000},(_,i)=>({id:String(i),fields:{}})):[{id:'1',fields:{}}]})});
  await assert.rejects(loadRows('contacts',new AbortController().signal),/changed/);
  global.fetch=async()=>({ok:false,status:401});await assert.rejects(loadRows('funding',new AbortController().signal),/Sign in/);
 } finally {global.fetch=originalFetch;}
});
