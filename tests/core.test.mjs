import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

// Test a clean installation, never the owner's database or local configuration.
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sandbox=path.join(packageRoot,'runtime','test-'+Date.now());
fs.mkdirSync(sandbox,{recursive:true});
for(const item of ['src','public','examples','package.json'])fs.cpSync(path.join(packageRoot,item),path.join(sandbox,item),{recursive:true});
const {TOOL,ROOT,openStore,graph,parseCSV,resolveSource,hash,putEntity,validateGraph}=await import(pathToFileURL(path.join(sandbox,'src/store.mjs')));
const {importWorkspace}=await import(pathToFileURL(path.join(sandbox,'src/importer.mjs')));
const {makeServer}=await import(pathToFileURL(path.join(sandbox,'src/server.mjs')));
const db=openStore(path.join(TOOL,'data','test.sqlite3'));
test.after(()=>db.close());

test('CSV preserves exact numbers, quoted fields and embedded newlines',()=>{
 const c=parseCSV('name,value,note\r\n"a,b",0.123456789012345,"one\n""two"""\r\n');
 assert.deepEqual(c.rows,[{name:'a,b',value:'0.123456789012345',note:'one\n"two"'}]);
 assert.throws(()=>parseCSV('a,b\n1,2,3'),/inconsistent/);assert.throws(()=>parseCSV('a\n"x'),/Unterminated/);
});
test('clean installation imports an explicitly fictional, connected demo',async()=>{
 const r=await importWorkspace(db);assert.equal(r.entities,8);assert.equal(r.assets,3);assert.equal(r.edges,10);
 assert.equal(validateGraph(db,{hashes:true}).pass,true);assert.match(graph(db).meta.scope,/虚构/);
 assert(graph(db).entities.every(e=>e.origin==='fictional-demo'));
});
test('reimport does not duplicate records or create entity revisions',async()=>{
 const before=graph(db).entities,hist=db.prepare('SELECT COUNT(*) n FROM history').get().n;
 assert.equal((await importWorkspace(db)).changed,0);assert.deepEqual(graph(db).entities,before);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM history').get().n,hist);
});
test('shared experiment and qualifying evidence remain explicit',()=>{
 const g=graph(db);assert.equal(g.edges.filter(e=>e.source==='e-demo'&&e.kind==='investigates').length,2);
 assert(g.edges.some(e=>e.source==='r-repeat'&&e.target==='c-demo'&&e.kind==='qualifies'));
 assert.equal(g.entities.filter(e=>e.id==='r-repeat').length,1);
});
test('source resolution rejects traversal and junction escape',()=>{
 assert.throws(()=>resolveSource('../demo.json'),/outside/);assert.throws(()=>resolveSource(path.resolve('/outside.txt')),/relative/);
 const link=path.join(ROOT,'escape');fs.symlinkSync(path.join(TOOL,'src'),link,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>resolveSource('escape/store.mjs'),/outside/);fs.unlinkSync(link);
});
test('changed source fingerprints are detected',()=>{
 const p=resolveSource('report.md'),original=fs.readFileSync(p);
 try{fs.appendFileSync(p,'changed');assert(validateGraph(db,{hashes:true}).issues.some(x=>x.includes('Changed source')));}
 finally{fs.writeFileSync(p,original);}assert.equal(validateGraph(db,{hashes:true}).pass,true);
});
test('optimistic revisions reject lost updates',()=>{
 const e={id:'q-manual',type:'question',title:'Manual question',sources:[]};db.exec('BEGIN');
 try{putEntity(db,e);putEntity(db,{...e,title:'Updated'},1);assert.throws(()=>putEntity(db,{...e,title:'Overwritten'},1),/Revision conflict/);assert.equal(graph(db).entities.find(x=>x.id===e.id).title,'Updated');}finally{db.exec('ROLLBACK');}
});
test('graph validation rejects wrong relationship types and missing evidence',()=>{
 db.exec('BEGIN');try{
  db.prepare('INSERT INTO edges VALUES(?,?,?,?)').run('q-demo','q-repeat','supports','invalid');
  putEntity(db,{id:'orphan',type:'result',title:'No evidence',sources:[]});
  const issues=validateGraph(db).issues;assert(issues.some(x=>x.includes('Invalid relationship types')));assert(issues.some(x=>x.includes('no source artifacts')));assert(issues.some(x=>x.includes('no run provenance')));
 }finally{db.exec('ROLLBACK');}
});
test('CLI records persist, reject stale revisions and roll back invalid batches',()=>{
 const input=path.join(TOOL,'data','record.json');
 const execute=bundle=>{fs.writeFileSync(input,JSON.stringify(bundle));return spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','src/cli.mjs','record',input,'--db','data/cli-test.sqlite3'],{cwd:TOOL,encoding:'utf8'});};
 assert.equal(execute({entities:[{id:'q-cli',type:'question',title:'CLI question',sources:[]}]}).status,0);
 assert.equal(execute({entities:[{id:'q-cli',type:'question',title:'Revision two',sources:[],expectedRevision:1}]}).status,0);
 const stale=execute({entities:[{id:'q-cli',type:'question',title:'Stale',expectedRevision:1}]});assert.equal(stale.status,1);assert.match(stale.stderr,/Revision conflict/);
 assert.equal(execute({entities:[{id:'q-rollback',type:'question',title:'Rollback'},{id:'r-orphan',type:'result',title:'Missing provenance'}]}).status,1);
 const other=openStore(path.join(TOOL,'data','cli-test.sqlite3'));try{assert.equal(graph(other).entities.length,1);assert.equal(graph(other).entities[0].title,'Revision two');}finally{other.close();}
});
test('failed import rolls back entities and source registrations',async()=>{
 const p=path.join(TOOL,'examples','demo.json'),original=fs.readFileSync(p),bundle=JSON.parse(original);bundle.entities.push({id:'bad-result',type:'result',title:'Missing run',sources:['report.md']});
 fs.writeFileSync(p,JSON.stringify(bundle));const before=graph(db);
 try{await assert.rejects(importWorkspace(db),/no run provenance/);assert.deepEqual(graph(db),before);}finally{fs.writeFileSync(p,original);}
});
test('HTTP serves exact source bytes, pagination and filters; rejects foreign hosts and writes',async()=>{
 const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/app.js')).status,200);
  assert.equal((await fetch(base+'/api/graph',{method:'POST'})).status,405);
  const foreign=await new Promise((resolve,reject)=>http.get(base+'/api/graph',{headers:{host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(foreign,403);
  assert.equal((await fetch(base+'/api/assets/a-0000000000000000')).status,404);assert.equal((await fetch(base+'/api/shutdown',{method:'POST'})).status,403);
  const g=graph(db),e=g.entities.find(e=>e.id==='r-demo'),a=g.assets.find(a=>a.id===e.table),original=fs.readFileSync(resolveSource(a.path));
  assert.equal(hash(Buffer.from(await(await fetch(base+'/api/assets/'+e.table+'/raw')).arrayBuffer())),hash(original));
  const page=await(await fetch(base+'/api/assets/'+e.table+'?limit=2&offset=1')).json();assert.deepEqual(page.rows,parseCSV(original.toString()).rows.slice(1,3));assert.equal(page.total,60);
  const filtered=await(await fetch(base+'/api/assets/'+e.table+'?column=mode&value=on')).json();assert.equal(filtered.filtered,30);assert(filtered.rows.every(r=>r.mode==='on'));
  assert.equal((await fetch(base+'/api/assets/'+e.table+'?column=missing&value=x')).status,400);assert.equal((await(await fetch(base+'/api/check')).json()).pass,true);
 }finally{await new Promise(r=>server.close(r));}
});
test('authenticated local shutdown closes the service',async()=>{
 let closed=false;const server=makeServer(db,{shutdownToken:'test-secret',onShutdown:()=>{closed=true;}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/shutdown',{method:'POST',headers:{'x-workbench-token':'wrong'}})).status,403);
 assert.equal((await fetch(base+'/api/shutdown',{method:'POST',headers:{'x-workbench-token':'test-secret'}})).status,200);
 for(let i=0;i<50&&!closed;i++)await new Promise(r=>setTimeout(r,20));assert(closed);
});

test('local workspace can start empty without importing fictional records',()=>{
 const local=path.join(TOOL,'local');fs.mkdirSync(local,{recursive:true});
 fs.writeFileSync(path.join(local,'workspace.json'),JSON.stringify({workspaceRoot:'examples/demo-workspace',title:'Configured workspace'}));
 const result=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','src/cli.mjs','import','--db','data/configured.sqlite3'],{cwd:TOOL,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const other=openStore(path.join(TOOL,'data','configured.sqlite3'));
 try{assert.equal(graph(other).entities.length,0);assert.equal(graph(other).meta.title,'Configured workspace');}finally{other.close();}
});
test('explicit local adapters load; adapters outside local are rejected',()=>{
 const config=path.join(TOOL,'local','workspace.json'),adapter=path.join(TOOL,'local','adapter.mjs');
 fs.writeFileSync(adapter,'export function importWorkspace(){return {adapterSelected:true};}');
 const execute=p=>{fs.writeFileSync(config,JSON.stringify({workspaceRoot:'examples/demo-workspace',adapter:p}));return spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','src/cli.mjs','import','--db','data/adapter.sqlite3'],{cwd:TOOL,encoding:'utf8'});};
 const allowed=execute('local/adapter.mjs');assert.equal(allowed.status,0,allowed.stderr);assert.equal(JSON.parse(allowed.stdout).adapterSelected,true);
 const denied=execute('src/store.mjs');assert.equal(denied.status,1);assert.match(denied.stderr,/Adapter must stay inside local/);
});
