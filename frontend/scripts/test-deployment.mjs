import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.ARGUS_DEPLOYMENT_URL || 'http://127.0.0.1:8002';
const root = fileURLToPath(new URL('../../', import.meta.url));
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1280,height:1000}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {if(message.type()==='error' && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text());});
try {
 const health = await page.request.get(base+'/api/health');
 assert.equal(health.status(),200);assert.equal((await health.json()).mode,'artifacts');
 const metrics = await (await page.request.get(base+'/api/metrics')).json();
 await page.goto(base+'/');
 await page.locator('.recharts-line-curve').waitFor();
 const paths = new Set();
 for (const model of ['rf','lr_current','lr_lag','oracle_persistence']) {
  await page.getByRole('combobox',{name:'Dashboard model'}).selectOption(model);
  const metric=metrics.models.find(m=>m.name===model);
  await page.waitForFunction(precision=>document.querySelectorAll('.kpi-value')[2]?.textContent===precision,`${(metric.precision*100).toFixed(1)}%`);
  paths.add(await page.locator('.recharts-line-curve').getAttribute('d'));
 }
 assert.equal(paths.size,4);console.log('PASS: real-artifact dashboard and four model selections');
 await page.getByRole('combobox',{name:'Dashboard model'}).selectOption('rf');
 await page.getByRole('button',{name:/^#\d+ ·/}).first().click();
 await page.getByText(/Window #\d+ Inspection/).waitFor();
 await page.getByRole('button',{name:/Generate analyst note/}).click();
 await page.getByText('Template fallback',{exact:true}).waitFor({timeout:80000});
 const note=await page.locator('.note-panel').innerText();
 for(const field of ['Threat Summary','Why Suspicious','Suggested Checks'])assert.ok(note.toLowerCase().includes(field.toLowerCase()));
 await page.getByRole('button',{name:/Close/}).click();
 console.log('PASS: window details and template fallback note fields');
 await page.goto(base+'/models');await page.getByRole('heading',{name:'Model comparison',exact:true}).waitFor();
 for (const label of ['Oracle persistence','Current-window LR','Lagged LR','Random Forest'])await page.getByRole('row',{name:new RegExp(label)}).waitFor();
 await page.goto(base+'/about');await page.getByRole('heading',{name:'Problem',exact:true}).waitFor();
 assert.equal((await page.request.get(base+'/api/missing')).status(),404);
 assert.equal((await page.request.get(base+'/.env')).status(),404);
 await page.goto(base+'/');await page.locator('.recharts-line-curve').waitFor();
 await mkdir(root+'runtime',{recursive:true});
 await page.screenshot({path:root+'runtime/argus-antideploy-dashboard.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: direct Models/About routes, private file protection, no JavaScript/CSP errors');
} finally {await browser.close();}
