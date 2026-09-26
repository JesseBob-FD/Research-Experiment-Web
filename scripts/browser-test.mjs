import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {TOOL} from '../src/store.mjs';
import {browser} from './cdp.mjs';
const base=process.argv[2]||'http://127.0.0.1:4317';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw new Error('Use a loopback workbench URL');
const data=await(await fetch(base+'/api/graph')).json();
const b=await browser(),checks=[];
fs.mkdirSync(path.join(TOOL,'acceptance'),{recursive:true});
async function check(name,fn){await fn();checks.push({name,pass:true});console.log('PASS '+name);}
const count=()=>b.evaluate('document.querySelectorAll("#cards .card").length');
try{
 await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await b.send('Page.navigate',{url:base+'/'});await b.wait('!!document.querySelector("#cards .card")');
 await check('workspace title and result records agree with stored data',async()=>{assert.equal(await count(),data.entities.filter(e=>e.type==='result').length);assert.equal(await b.evaluate('document.querySelector("#project-title").textContent'),data.meta.title);await b.screenshot('public-results');});
 await check('search empty state can be reset',async()=>{await b.fill('#search','no-such-record-73912');await b.wait('!!document.querySelector(".empty")');await b.click('.empty [data-reset]');await b.wait('!!document.querySelector("#cards .card")');});
 await check('record dialog and relationship navigation work',async()=>{await b.click('#cards .primary-link');await b.wait('document.querySelector("#detail").open');await b.click('#detail [data-related]');await b.click('[data-detail-back]');await b.click('#detail [data-close]');});
 await check('original CSV opens with exact source values',async()=>{
 const e=data.entities.find(e=>e.type==='result'&&e.table),table=await(await fetch(base+'/api/assets/'+e.table)).json();
 await b.click('[data-record="'+e.id+'"] .card-footer [data-source]');await b.wait('!!document.querySelector("#source tbody td")');
 const displayed=await b.evaluate('[...document.querySelectorAll("#source tbody tr:first-child td")].map(e=>e.textContent)');assert.deepEqual(displayed,table.columns.map(c=>table.rows[0][c]));await b.click('#source [data-close]');
 });
 await check('conclusion-only view exposes limits and no result figures',async()=>{await b.click('[data-view="conclusion"]');assert.equal(await count(),data.entities.filter(e=>e.type==='conclusion').length);assert.equal(await b.evaluate('document.querySelectorAll("#cards img").length'),0);await b.screenshot('public-conclusions');});
 await check('about view checks registered source hashes',async()=>{await b.click('#about');await b.click('#check-sources');await b.wait('document.querySelector("#check-output")?.textContent.includes("校验通过")');});
 await check('mobile layout and dialogs fit the viewport',async()=>{await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.click('[data-view="result"]');assert(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));await b.click('#cards .primary-link');await b.wait('document.querySelector("#detail").open');assert(await b.evaluate('document.querySelector("#detail").getBoundingClientRect().width<=innerWidth'));await b.screenshot('public-mobile');await b.click('#detail [data-close]');});
 await check('original images load without browser errors',async()=>{await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await b.evaluate('window.scrollTo(0,document.body.scrollHeight)');await b.wait('[...document.querySelectorAll("#cards img")].every(i=>i.complete&&i.naturalWidth>0)');assert.equal(await b.evaluate('document.querySelectorAll(".figure-error").length'),0);assert.deepEqual(b.events.filter(e=>e.method==='Runtime.exceptionThrown'||(e.method==='Log.entryAdded'&&e.params.entry.level==='error')||(e.method==='Network.loadingFailed'&&!e.params.canceled)),[]);});
 fs.writeFileSync(path.join(TOOL,'acceptance','browser-results.json'),JSON.stringify({pass:true,checks},null,2));
}catch(e){console.error(e);fs.writeFileSync(path.join(TOOL,'acceptance','browser-results.json'),JSON.stringify({pass:false,checks,error:e.stack},null,2));process.exitCode=1;}finally{b.close();}
