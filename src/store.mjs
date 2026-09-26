import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {TOOL,ROOT} from './config.mjs';
export {TOOL,ROOT} from './config.mjs';
import {DatabaseSync} from 'node:sqlite';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const assetId=p=>'a-'+hash(p.replaceAll('\\','/')).slice(0,16);
export function resolveSource(relative){
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\0'))throw new Error('Expected workspace-relative source path');
  const within=(base,p)=>{const r=path.relative(base,p);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
  const safe=(base,tool,p)=>within(base,p)&&!(within(base,tool)&&(p===tool||within(tool,p)));
  const candidate=path.resolve(ROOT,relative);
  if(!safe(ROOT,TOOL,candidate))throw new Error('Source outside allowed workspace');
  const actual=fs.realpathSync(candidate),realRoot=fs.realpathSync(ROOT),realTool=fs.realpathSync(TOOL);
  if(!safe(realRoot,realTool,actual))throw new Error('Source symlink outside allowed workspace');
  if(!fs.statSync(actual).isFile())throw new Error('Source must be a file');return actual;
}
export function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('Unterminated CSV field');if(field||row.length){row.push(field);rows.push(row);}const columns=rows.shift()||[];
  if(new Set(columns).size!==columns.length)throw new Error('Duplicate CSV headers');
  return{columns,rows:rows.map((r,i)=>{if(r.length!==columns.length)throw new Error(`CSV row ${i+2} has inconsistent columns`);return Object.fromEntries(columns.map((k,j)=>[k,r[j]]));})};
}
export function openStore(dbPath=path.join(TOOL,'data','research.sqlite3')){
  const full=path.resolve(dbPath);if(!full.startsWith(TOOL+path.sep))throw new Error('Database must stay inside tool directory');fs.mkdirSync(path.dirname(full),{recursive:true});const db=new DatabaseSync(full);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,type TEXT NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS edges(source TEXT NOT NULL REFERENCES entities(id),target TEXT NOT NULL REFERENCES entities(id),kind TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(source,target,kind));
  CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,kind TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,changed_at TEXT NOT NULL);`);return db;
}
export function validateEntity(e){if(!e||!['question','experiment','run','result','conclusion'].includes(e.type)||typeof e.id!=='string'||!/^[-a-zA-Z0-9_]+$/.test(e.id)||typeof e.title!=='string'||!e.title.trim())throw new Error('Entity requires valid id, type and title');if(e.sources&&(!Array.isArray(e.sources)||e.sources.some(x=>typeof x!=='string')))throw new Error('sources must be an array of asset IDs');}
export function putEntity(db,e,expectedRevision){validateEntity(e);const old=db.prepare('SELECT * FROM entities WHERE id=?').get(e.id);if(old&&expectedRevision!==undefined&&old.revision!==expectedRevision)throw new Error('Revision conflict');if(old&&old.type!==e.type)throw new Error('Entity type cannot be changed');const json=JSON.stringify(e);if(old?.data===json)return false;const rev=old?old.revision+1:1;db.prepare('INSERT INTO history(entity_id,revision,data,changed_at) VALUES(?,?,?,?)').run(e.id,rev,json,new Date().toISOString());db.prepare('INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision').run(e.id,e.type,json,rev);return true;}
export function graph(db){return{entities:db.prepare('SELECT data,revision FROM entities ORDER BY rowid').all().map(x=>({...JSON.parse(x.data),revision:x.revision})),edges:db.prepare('SELECT * FROM edges').all(),assets:db.prepare('SELECT * FROM assets').all(),meta:Object.fromEntries(db.prepare('SELECT * FROM meta').all().map(x=>[x.key,JSON.parse(x.value)]))};}
export function validateGraph(db,{hashes=false}={}){
 const g=graph(db),issues=[],assets=new Map(g.assets.map(a=>[a.id,a])),entities=new Map(g.entities.map(e=>[e.id,e]));
 const relationTypes={investigates:['experiment','question'],executes:['run','experiment'],from_run:['result','run'],supports:['result','conclusion'],qualifies:['result','conclusion'],contradicts:['result','conclusion'],answers:['conclusion','question']};
 for(const r of g.edges){const pair=relationTypes[r.kind];if(!pair||entities.get(r.source)?.type!==pair[0]||entities.get(r.target)?.type!==pair[1])issues.push(`Invalid relationship types: ${r.source} ${r.kind} ${r.target}`);}
 for(const e of g.entities){
  try{validateEntity(e);}catch(err){issues.push(`${e.id}: ${err.message}`);}
  for(const id of e.sources||[])if(!assets.has(id))issues.push(`${e.id}: missing source ${id}`);
  for(const key of ['figure','table'])if(e[key]&&!assets.has(e[key]))issues.push(`${e.id}: missing ${key}`);
  if(e.type==='result'){
   if(!e.sources?.length)issues.push(`${e.id}: no source artifacts`);
   if(!g.edges.some(x=>x.source===e.id&&x.kind==='from_run'))issues.push(`${e.id}: no run provenance`);
  }
  if(e.type==='conclusion'&&!g.edges.some(x=>x.target===e.id&&['supports','qualifies','contradicts'].includes(x.kind)))issues.push(`${e.id}: no evidence`);
 }
 for(const a of g.assets)try{const p=resolveSource(a.path);if(hashes&&hash(fs.readFileSync(p))!==a.sha256)issues.push(`Changed source: ${a.path}`);}catch{issues.push(`Unavailable source: ${a.path}`);}
 return{pass:issues.length===0,entities:g.entities.length,edges:g.edges.length,assets:g.assets.length,issues};
}
