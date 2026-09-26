import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {TOOL,openStore,graph,validateGraph,putEntity,validateEntity,resolveSource,assetId,hash} from './store.mjs';
import {importWorkspace} from './importer.mjs';
import {serve} from './server.mjs';
const [command='serve',...args]=process.argv.slice(2);
const dbIndex=args.indexOf('--db');
const dbPath=dbIndex>=0?path.resolve(TOOL,args[dbIndex+1]):undefined;
if(dbIndex>=0)args.splice(dbIndex,2);
const db=openStore(dbPath);
fs.mkdirSync(path.join(TOOL,'runtime'),{recursive:true});
function log(value){fs.appendFileSync(path.join(TOOL,'runtime','operations.jsonl'),JSON.stringify({at:new Date().toISOString(),command,database:dbPath||'data/research.sqlite3',...value})+'\n');console.log(JSON.stringify(value,null,2));}
try{
 if(command==='stop'){
  const info=JSON.parse(fs.readFileSync(path.join(TOOL,'runtime','server.json'),'utf8'));
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url))throw new Error('Invalid local server address');
  const response=await fetch(info.url+'/api/shutdown',{method:'POST',headers:{'x-workbench-token':info.shutdownToken||''},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Server did not accept the shutdown token');log({stopped:true});db.close();
 }
 else if(command==='import'){log(await importWorkspace(db));db.close();}
 else if(command==='check'){const result=validateGraph(db,{hashes:true});log(result);db.close();if(!result.pass)process.exitCode=1;}
 else if(command==='export'){const out=path.join(TOOL,'data','export.json');fs.writeFileSync(out,JSON.stringify(graph(db),null,2));log({exported:out});db.close();}
 else if(command==='record'){
  if(!args[0])throw new Error('Usage: node src/cli.mjs record data/record.json');
  const input=path.resolve(TOOL,args[0]);if(!input.startsWith(TOOL+path.sep))throw new Error('Input JSON must be inside tool directory');
  const bundle=JSON.parse(fs.readFileSync(input,'utf8'));if(!Array.isArray(bundle.entities))throw new Error('Expected entities array');
  db.exec('BEGIN IMMEDIATE');try{
   for(const relative of bundle.sourcePaths||[]){const bytes=fs.readFileSync(resolveSource(relative)),id=assetId(relative);db.prepare('INSERT INTO assets VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sha256=excluded.sha256,size=excluded.size').run(id,relative,hash(bytes),bytes.length,path.extname(relative).slice(1));}
   for(const item of bundle.entities){const {expectedRevision,...entity}=item;validateEntity(entity);const old=db.prepare('SELECT data FROM entities WHERE id=?').get(entity.id);if(old&&JSON.parse(old.data).imported)throw new Error('Imported entities are managed by the adapter; create a new record for follow-up work');if(old&&expectedRevision===undefined)throw new Error('Updating a record requires expectedRevision');putEntity(db,entity,expectedRevision);}
   for(const e of bundle.edges||[]){if(!['investigates','executes','from_run','supports','qualifies','contradicts','answers'].includes(e.kind))throw new Error('Unknown relationship kind');db.prepare('INSERT OR REPLACE INTO edges VALUES(?,?,?,?)').run(e.source,e.target,e.kind,e.label||e.kind);}
   const check=validateGraph(db);if(!check.pass)throw new Error(check.issues.join('; '));db.exec('COMMIT');log({recorded:bundle.entities.length});
  }catch(e){db.exec('ROLLBACK');throw e;}db.close();
 }
 else if(command==='serve'){
  if(!graph(db).entities.length)log(await importWorkspace(db));
  const portIndex=args.indexOf('--port'),port=portIndex>=0?Number(args[portIndex+1]):4317;
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
  let live;
  try{live=await serve(db,{port});}catch(e){if(e.code==='EADDRINUSE'){
   try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);const h=await r.json();if(h.application==='research-workbench'){console.log(`Existing workbench: http://127.0.0.1:${port}`);live={url:`http://127.0.0.1:${port}`};db.close();}else throw e;}catch{throw new Error(`Port ${port} is occupied. Use --port 4318.`);}
  }else throw e;}
  if(args.includes('--open'))spawn('powershell.exe',['-NoProfile','-Command',`Start-Process '${live.url}'`],{stdio:'ignore',windowsHide:true});
 }else{throw new Error('Commands: serve [--open] [--port 4317], stop, import, check, export, record <json>');}
}catch(e){fs.appendFileSync(path.join(TOOL,'runtime','errors.log'),new Date().toISOString()+' '+command+' '+e.stack+'\n');console.error(e.message);process.exitCode=1;try{db.close();}catch{}}
