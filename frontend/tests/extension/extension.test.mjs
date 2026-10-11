import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../extension/', import.meta.url);
test('MV3 popup only requests active tab and local API access', async () => {
 const m = JSON.parse(await readFile(new URL('manifest.json', root)));
 assert.equal(m.manifest_version, 3);
 assert.deepEqual(m.permissions, ['activeTab']);
 assert.deepEqual(m.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*']);
 assert.equal(m.action.default_popup, 'popup.html');
});
test('model projection uses each score and preserves a zero threshold', async () => {
 const { project } = await import(new URL('core.js', root));
 const data = [{id:0,risk:.9,risk_by_model:{rf:.9,lr_current:.2}}];
 assert.equal(project(data,'rf',0,'rf')[0].flagged,true);
 assert.equal(project(data,'lr_current',.5,'rf')[0].flagged,false);
 assert.throws(()=>project(data,'lr_lag',.5,'rf'), /unavailable/i);
});
test('HTTP errors and disconnects become readable messages without stack traces', async () => {
 const { request } = await import(new URL('core.js', root));
 await assert.rejects(request('/meta',{}, async()=>({ok:false,status:503})), /503/);
 await assert.rejects(request('/meta',{}, async()=>{throw new Error('secret stack')}), /Start the local Argus backend/);
});
