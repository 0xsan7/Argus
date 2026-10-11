import {test} from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../../extension/site.js', import.meta.url);
const snapshot = (overrides={}) => ({
 origin:'https://example.test', secureContext:true, capturedAt:1, timeOrigin:1,
 navigation:{duration:120, responseStatus:200}, resources:[], forms:[],
 insecureElements:0, resourceTotal:0, ...overrides,
});
test('website rules are independent of the trained network model and zero is not a safety verdict', async()=>{
 const {analyzeSite}=await import(moduleUrl);
 const result=analyzeSite(snapshot());
 assert.equal(result.indicator,0);
 assert.match(result.verdict,/No listed exposure signals/);
 assert.match(result.caveat,/not.*model/i);
 assert.match(result.coverage,/top-level.*retained/i);
});
test('HTTPS mixed resources and cleartext password submission produce explicit rule findings', async()=>{
 const {analyzeSite}=await import(moduleUrl);
 const result=analyzeSite(snapshot({insecureElements:2,forms:[{password:true,insecure:true,external:false}]}));
 assert.equal(result.indicator,65);
 assert.deepEqual(result.findings.filter(f=>f.points).map(f=>f.code),['mixed-content','password-http']);
});
test('public HTTP and local development are distinguished, unavailable status/bytes are not failures', async()=>{
 const {analyzeSite}=await import(moduleUrl);
 assert.equal(analyzeSite(snapshot({origin:'http://example.test'})).indicator,40);
 const result=analyzeSite(snapshot({origin:'http://127.0.0.1:9090',resources:[{origin:'https://cdn.test',type:'script',start:5,duration:20,transfer:0,status:0}]}));
 assert.equal(result.indicator,0);
 assert.equal(result.unknownStatuses,1);
 assert.equal(result.errors,0);
 assert.equal(result.origins[0].bytes,null);
 assert.equal(result.externalRequests,1);
});
test('resource aggregation caps table size, preserves errors and emits a nonblank request timeline', async()=>{
 const {analyzeSite}=await import(moduleUrl);
 const resources=Array.from({length:50},(_,i)=>({origin:`https://cdn${i}.test`,type:'fetch',start:i*1000,duration:10,transfer:12,status:i===0?503:200}));
 const result=analyzeSite(snapshot({resources,resourceTotal:70}));
 assert.equal(result.errors,1);
 assert.equal(result.origins.length,20);
 assert.equal(result.timeline.reduce((n,b)=>n+b.count,0),50);
 assert.equal(result.omittedResources,20);
 assert.doesNotMatch(JSON.stringify(result),/secret=|\/private/);
});
test('restricted pages and permission errors have actionable, sanitized messages', async()=>{
 const {canInspect,inspectionError}=await import(moduleUrl);
 assert.equal(canInspect('https://example.test/private?secret=1'),true);
 for(const url of ['chrome://extensions','about:blank','file:///tmp/private','chrome-extension://abc','https://chromewebstore.google.com/detail/abc','https://chrome.google.com/webstore/detail/abc'])assert.equal(canInspect(url),false);
 assert.doesNotMatch(inspectionError(new Error('secret stack trace')),/secret|stack/i);
 assert.match(inspectionError(new Error('Cannot access contents of url')),/toolbar icon/i);
});
test('website performance report changes with actual measurements, without inventing accuracy or varying equal rule scores',async()=>{
 const {analyzeSite}=await import(moduleUrl);
 const fast=analyzeSite(snapshot({navigation:{duration:200,responseStatus:200},resources:[{origin:'https://example.test',type:'fetch',start:10,duration:40,transfer:300,status:200}]}));
 const slow=analyzeSite(snapshot({navigation:{duration:4500,responseStatus:200},resources:[{origin:'https://example.test',type:'fetch',start:20,duration:1800,transfer:3*1024*1024,status:503}]}));
 assert.equal(fast.performance.medianMs,40);
 assert.equal(slow.performance.medianMs,1800);
 assert.equal(fast.performance.knownErrorRate,0);
 assert.equal(slow.performance.knownErrorRate,1);
 assert.equal(fast.performance.checks.find(c=>c.code==='load').status,'within');
 assert.equal(slow.performance.checks.find(c=>c.code==='load').status,'exceeded');
 assert.equal(slow.performance.checks.find(c=>c.code==='transfer').status,'exceeded');
 assert.equal(fast.indicator,slow.indicator,'Equal security evidence must retain equal rule scores');
 assert.equal('precision' in fast.performance,false);
});
test('performance report marks missing timing and partial transfer coverage as unavailable, not passing',async()=>{
 const {analyzeSite}=await import(moduleUrl);
 const report=analyzeSite(snapshot({navigation:{duration:null,responseStatus:null},resources:[{origin:'https://cdn.test',type:'script',start:1,duration:0,transfer:0,status:0}]}));
 assert.equal(report.performance.medianMs,null);
 assert.equal(report.performance.knownErrorRate,null);
 assert.equal(report.performance.checks.find(c=>c.code==='load').status,'unavailable');
 assert.equal(report.performance.checks.find(c=>c.code==='transfer').status,'incomplete');
});
