import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {TOOL,graph,resolveSource,parseCSV,validateGraph,hash} from './store.mjs';
const mime={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',png:'image/png',svg:'image/svg+xml',jpg:'image/jpeg',json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',md:'text/plain; charset=utf-8'};
export function makeServer(db,{shutdownToken,onShutdown}={}){
 const server=http.createServer((req,res)=>{
  const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
  try{
   if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))return send(403,{error:'Local host required'});
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='POST'&&url.pathname==='/api/shutdown'){
    if(!shutdownToken||req.headers['x-workbench-token']!==shutdownToken)return send(403,{error:'Local launcher token required'});
    send(200,{stopped:true});setImmediate(()=>server.close(()=>onShutdown?.()));return;
   }
   if(req.method!=='GET')return send(405,{error:'只读浏览接口；请通过本地 CLI 登记研究记录。'});
   if(url.pathname==='/api/health')return send(200,{ok:true,application:'research-workbench',version:'0.1.0'});
   if(url.pathname==='/api/graph')return send(200,graph(db));
   if(url.pathname==='/api/check')return send(200,validateGraph(db,{hashes:true}));
   if(url.pathname==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="research-records.json"');return send(200,graph(db));}
   const match=url.pathname.match(/^\/api\/assets\/(a-[0-9a-f]{16})(\/raw)?$/);
   if(match){
    const a=db.prepare('SELECT * FROM assets WHERE id=?').get(match[1]);if(!a)return send(404,{error:'来源不存在'});
    let p;try{p=resolveSource(a.path);}catch{return send(404,{error:'来源文件不可用；记录已保留，请核对原始路径。'});}
    const bytes=fs.readFileSync(p);
    if(match[2]){if(!['png','jpg','svg'].includes(a.kind))res.setHeader('Content-Disposition','inline; filename="'+path.basename(a.path).replaceAll('"','')+'"');return send(200,bytes,mime[a.kind]||'text/plain; charset=utf-8');}
    const meta={...a,unchanged:hash(bytes)===a.sha256};
    if(a.kind==='csv'){
     const csv=parseCSV(bytes.toString('utf8'));let rows=csv.rows;
     const q=(url.searchParams.get('q')||'').toLowerCase(),column=url.searchParams.get('column'),value=url.searchParams.get('value');
     if(column&&value!==null){if(!csv.columns.includes(column))return send(400,{error:'Unknown column'});rows=rows.filter(r=>r[column]===value);}
     if(q)rows=rows.filter(r=>Object.values(r).some(v=>v.toLowerCase().includes(q)));
     const offset=Math.max(0,Number(url.searchParams.get('offset'))||0),limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit'))||50));
     return send(200,{...meta,columns:csv.columns,total:csv.rows.length,filtered:rows.length,offset,rows:rows.slice(offset,offset+limit)});
    }
    return send(200,{...meta,text:['md','json','txt'].includes(a.kind)?bytes.toString('utf8').slice(0,1000000):null});
   }
   const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
   if(files[url.pathname])return send(200,fs.readFileSync(path.join(TOOL,'public',files[url.pathname])),mime[path.extname(files[url.pathname]).slice(1)]);
   return send(404,{error:'Not found'});
  }catch(e){console.error(e);return send(500,{error:'读取失败：'+e.message});}
 });return server;
}
export async function serve(db,{port=4317}={}){
 const shutdownToken=randomBytes(32).toString('hex');
 const server=makeServer(db,{shutdownToken,onShutdown:()=>db.close()});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const url=`http://127.0.0.1:${server.address().port}`;
 fs.mkdirSync(path.join(TOOL,'runtime'),{recursive:true});fs.writeFileSync(path.join(TOOL,'runtime','server.json'),JSON.stringify({pid:process.pid,url,startedAt:new Date().toISOString(),shutdownToken}));
 console.log('Research Workbench '+url);return{server,url};
}
