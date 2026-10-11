// Run with a locally installed Chromium-family browser; no downloads or external sites.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=path.resolve(fileURLToPath(new URL('../../extension/',import.meta.url)));
const id=createHash('sha256').update(dir).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const profile=await mkdtemp(path.join(tmpdir(),'argus-extension-test-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.EXTENSION_BROWSER || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true,viewport:{width:460,height:600},args:[`--disable-extensions-except=${dir}`,`--load-extension=${dir}`]});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const open=async()=>{await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForFunction(()=>!document.querySelector('#status .spinner'));};
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
try{
 await open();assert.equal(await page.evaluate(()=>chrome.runtime.getManifest().manifest_version),3);
 assert.match(await page.locator('#status').innerText(),/Historical benchmark/);
 assert.match(await page.locator('#kpis').innerText(),/17,240/);
 const paths=new Set();
 for(const model of ['rf','lr_current','lr_lag','oracle_persistence']){await page.selectOption('#model',model);paths.add(await page.locator('#chart svg path').first().getAttribute('d'));assert.equal(await page.locator('#inspect button').count(),5);}
 assert.equal(paths.size,4);console.log('PASS: installed MV3 extension, real 17,240-window API, four distinct model series');
 await page.selectOption('#model','rf');await page.locator('#inspect button').first().click();await page.getByRole('button',{name:'Generate analyst note'}).waitFor();assert.match(await page.locator('#detail').innerText(),/SHAP/);
 // Note responses below are controlled fixtures, not real Gemma output.
 for(const source of ['gemma','template']){
 await page.route('**/api/windows/*/note',r=>json(r,{source,model:source==='gemma'?'controlled-test':null,threat_summary:'Test summary',why_suspicious:'Test reason',suggested_checks:['Test check'],caveat:'Test caveat'}));
 await page.getByRole('button',{name:'Generate analyst note'}).click();await page.waitForFunction(()=>document.querySelector('#note').textContent.includes('Test caveat'));
 assert.match(await page.locator('#note').innerText(),source==='gemma'?/Gemma/:/Template fallback/);await page.unroute('**/api/windows/*/note');
 }
 await page.route('**/api/windows/*/note',r=>json(r,{},503));await page.getByRole('button',{name:'Generate analyst note'}).click();await page.waitForFunction(()=>document.querySelector('#note').textContent.includes('503'));await page.unroute('**/api/windows/*/note');
 let resolveA;const pending=new Promise(r=>resolveA=r);await page.route('**/api/windows/*/note',async r=>{await pending;await json(r,{source:'template',threat_summary:'STALE A',why_suspicious:'A',suggested_checks:[],caveat:'A'});});
 await page.getByRole('button',{name:'Generate analyst note'}).click();await page.locator('#inspect button').nth(1).click();await page.getByRole('button',{name:'Generate analyst note'}).waitFor();resolveA();await page.waitForTimeout(100);assert.doesNotMatch(await page.locator('#detail').innerText(),/STALE A/);await page.unroute('**/api/windows/*/note');console.log('PASS: window details, controlled Gemma/fallback/error notes, stale response protection');
 for(const origin of ['https://site-a.example','https://site-b.example']){
 // activeTab context is controlled here; no external page or tab data is transmitted.
 await page.addInitScript(origin=>{chrome.tabs.query=async()=>[{url:origin+'/private?secret=1'}];},origin);await open();assert.match(await page.locator('#site').innerText(),new RegExp(origin.replaceAll('.','\\.')));assert.doesNotMatch(await page.locator('#site').innerText(),/secret/);
 }
 console.log('PASS: two controlled website contexts, origin-only display');
 let releaseLoading;const slow=new Promise(r=>releaseLoading=r);await page.route('**/api/meta',async r=>{await slow;await r.continue();});await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForSelector('#status .spinner');assert.equal(await page.locator('#results').isVisible(),false);releaseLoading();await page.waitForFunction(()=>!document.querySelector('#status .spinner'));await page.unroute('**/api/meta');console.log('PASS: visible loading spinner while data is pending');
 await page.route('**/api/timeline?split=test',r=>json(r,[]));await open();assert.match(await page.locator('#chart').innerText(),/No test windows/);await page.unroute('**/api/timeline?split=test');
 await page.route('**/api/meta',r=>json(r,{},503));await open();assert.match(await page.locator('#status').innerText(),/503/);await page.unroute('**/api/meta');
 await page.route('**/api/meta',r=>r.abort('connectionrefused'));await open();assert.match(await page.locator('#status').innerText(),/Start the local Argus backend/);await page.unroute('**/api/meta');
 await page.getByRole('button',{name:'Refresh connection'}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Historical'));
 const newPage=context.waitForEvent('page');await page.getByRole('button',{name:'Models',exact:true}).click();const consolePage=await newPage;await consolePage.waitForURL('http://127.0.0.1:5173/models');await consolePage.close();
 await page.screenshot({path:path.join(tmpdir(),'argus-extension-verified.png'),fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: empty, HTTP 503, disconnected, retry, full-console link; no JavaScript errors');
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
