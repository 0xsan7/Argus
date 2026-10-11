// Real local API + Ollama smoke test. This does not mock Gemma output.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5173');
 await page.getByRole('heading',{name:'Gemma analyst report',exact:true}).waitFor();
 await page.selectOption('[aria-label="Analyst report window"]','46');
 const responseEvent=page.waitForResponse(r=>r.url().endsWith('/api/windows/46/note') && r.request().method()==='POST',{timeout:75000});
 await page.getByRole('button',{name:'Generate Gemma report',exact:true}).click({noWaitAfter:true});
 assert.equal(await page.locator('.window-modal').count(),0,'Dashboard reports must not depend on window details');
 const response=await responseEvent;assert.equal(response.status(),200);const note=await response.json();
 assert.equal(note.source,'gemma','Real local Gemma must succeed; a template is not a Gemma result');
 assert.equal(note.model,'gemma4:e2b-mlx');assert.equal(note.window_id,46);
 for(const key of ['threat_summary','why_suspicious','caveat'])assert.ok(typeof note[key]==='string' && note[key].trim());
 assert.ok(Array.isArray(note.suggested_checks) && note.suggested_checks.length>0);
 await page.locator('.note-source-badge').getByText('Gemma',{exact:true}).waitFor();
 const normalize=value=>value.replace(/\s+/g,' ').trim();
 const panel=normalize(await page.locator('.note-panel').innerText());
 for(const key of ['threat_summary','why_suspicious','caveat'])assert.ok(panel.includes(normalize(note[key])));
 for(const check of note.suggested_checks)assert.ok(panel.includes(normalize(check)));
 const freshResponse=page.waitForResponse(r=>r.url().endsWith('/api/windows/46/note?refresh=true') && r.request().method()==='POST',{timeout:75000});
 await page.getByRole('button',{name:'Regenerate analyst note',exact:true}).click();
 const fresh=await freshResponse;assert.equal(fresh.status(),200);
 const freshNote=await fresh.json();assert.equal(freshNote.source,'gemma');assert.equal(freshNote.window_id,46);
 await page.locator('.note-source-badge').getByText('Gemma',{exact:true}).waitFor();
 assert.ok(normalize(await page.locator('.note-panel').innerText()).includes(normalize(freshNote.threat_summary)));
 await page.locator('.note-panel').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.resolve(fileURLToPath(new URL('../../runtime/gemma-console-report.png',import.meta.url))),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: inline dashboard report without window-detail dependency, fresh local Gemma regeneration, all report fields and source badge, no JavaScript errors');
}finally{await browser.close();}
