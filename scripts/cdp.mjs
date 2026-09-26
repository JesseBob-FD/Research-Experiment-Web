import fs from 'node:fs';
import path from 'node:path';
import {TOOL} from '../src/store.mjs';
export async function browser(){
 const tabs=await(await fetch('http://127.0.0.1:9337/json/list')).json();
 const tab=tabs.find(t=>t.type==='page');if(!tab)throw new Error('No test browser page');
 const ws=new WebSocket(tab.webSocketDebuggerUrl);let serial=0;const pending=new Map(),events=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else events.push(m);});
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=async expression=>{const start=Date.now();while(Date.now()-start<18000){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error('UI wait failed: '+expression);};
 const click=async selector=>{const rect=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing selector '+${JSON.stringify(selector)});if(e.disabled)throw Error('Disabled control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});};
 const fill=async(selector,value,event='input')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const screenshot=async(name)=>{await evaluate('document.fonts.ready');await evaluate('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const output=path.join(TOOL,'acceptance',name+'.png');fs.writeFileSync(output,Buffer.from(r.data,'base64'));return output;};
 await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
 return{send,evaluate,wait,click,fill,screenshot,events,close:()=>ws.close()};
}
