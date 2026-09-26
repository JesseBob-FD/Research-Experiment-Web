import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TOOL,workspaceConfig,DEMO} from './config.mjs';
import {resolveSource,assetId,hash,putEntity,validateGraph} from './store.mjs';

// The local adapter is trusted code selected by the owner; it is never downloaded.
export async function importWorkspace(db){
 if(workspaceConfig.adapter){
  const local=fs.realpathSync(path.join(TOOL,'local'));
  const adapter=fs.realpathSync(path.resolve(TOOL,workspaceConfig.adapter));
  const relative=path.relative(local,adapter);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Adapter must stay inside local/');
  const loaded=await import(pathToFileURL(adapter).href);
  if(typeof loaded.importWorkspace!=='function')throw new Error('Adapter must export importWorkspace(db)');
  return await loaded.importWorkspace(db);
 }
 if(!DEMO){
  const meta={title:workspaceConfig.title||'本地研究空间',scope:'通过本地 CLI 登记的研究记录。',campaigns:[],importedAt:new Date().toISOString()};
  for(const [key,value] of Object.entries(meta))db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run(key,JSON.stringify(value));
  return{changed:0,note:'No adapter configured; use record to add records.'};
 }
 return importDemo(db);
}

export function importDemo(db){
 const bundle=JSON.parse(fs.readFileSync(path.join(TOOL,'examples','demo.json'),'utf8'));
 const assets=new Map();
 for(const relative of bundle.sourcePaths){const bytes=fs.readFileSync(resolveSource(relative));assets.set(relative,{id:assetId(relative),path:relative,sha256:hash(bytes),size:bytes.length,kind:path.extname(relative).slice(1)});}
 let changed=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const a of assets.values())db.prepare('INSERT INTO assets VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sha256=excluded.sha256,size=excluded.size').run(a.id,a.path,a.sha256,a.size,a.kind);
  for(const item of bundle.entities){const e={...item,imported:true,origin:'fictional-demo',evidenceLabel:'虚构演示 · 不是真实研究'};
   e.sources=(e.sources||[]).map(p=>assets.get(p).id);
   for(const key of ['figure','table'])if(e[key])e[key]=assets.get(e[key]).id;
   if(putEntity(db,e))changed++;
  }
  for(const e of bundle.edges)db.prepare('INSERT OR REPLACE INTO edges VALUES(?,?,?,?)').run(e.source,e.target,e.kind,e.label||e.kind);
  for(const [key,value] of Object.entries({...bundle.meta,importedAt:new Date().toISOString()}))db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,JSON.stringify(value));
  const check=validateGraph(db,{hashes:true});if(!check.pass)throw new Error(check.issues.join('; '));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return{changed,entities:bundle.entities.length,edges:bundle.edges.length,assets:assets.size};
}
