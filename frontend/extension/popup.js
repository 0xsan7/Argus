import {request, project} from './core.js';
const $ = id => document.getElementById(id);
const text = (tag, value, cls) => {const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
let bundle, current, generation=0, loadGeneration=0;
function status(message, error=false) {$('status').textContent=message;$('status').className=error?'error':'';}
function loading(message) {status(message);const s=document.createElement('span');s.className='spinner';$('status').prepend(s);}
async function load() {
 const token=++loadGeneration;++generation;current=null;bundle=null;$('detail').hidden=true;$('results').hidden=true;loading(' Connecting to local Argus…');
 try {
  const [health,meta,windows,metrics]=await Promise.all(['/health','/meta','/timeline?split=test','/metrics'].map(p=>request(p)));
  if(token!==loadGeneration)return;
  if(!health.ok)throw new Error('Argus is not ready. Check the backend and retry.');
  if(!Array.isArray(windows)||!Array.isArray(metrics.models))throw new Error('Argus returned an unsupported data format. Refresh after checking the backend.');
  bundle={health,meta,windows,metrics};$('model').value=meta.default_model || 'rf';$('results').hidden=false;render();
 } catch(e){if(token===loadGeneration)status(e.message,true);}
}
function render() {
 ++generation;current=null;$('detail').hidden=true;
 const {health,meta,windows,metrics}=bundle, model=$('model').value;
 const metric=metrics.models.find(m=>m.name===model);
 try {
  if(!metric)throw new Error('Metrics for this model are unavailable. Select another model.');
  const threshold=metric.threshold ?? (model==='oracle_persistence'?.5:meta.default_threshold);
  if(!Number.isFinite(threshold))throw new Error('The model threshold is unavailable.');
  const rows=project(windows,model,threshold,meta.default_model);
  status(`${health.mode==='fixtures'?'Illustrative fixtures — not benchmark output':'Historical benchmark data'} · ${meta.dataset} · ${meta.run_id}`);
  $('kpis').replaceChildren();
  for(const [label,value] of [['Test windows',rows.length.toLocaleString()],['Flagged',rows.filter(w=>w.flagged).length.toLocaleString()],['Precision',percent(metric.precision)],['Recall',percent(metric.recall)]]) {
   const card=text('div','', 'kpi');card.append(text('strong',value),text('span',label));$('kpis').append(card);
  }
  draw(rows,threshold);$('inspect').replaceChildren();
  const flagged=rows.filter(w=>w.flagged).sort((a,b)=>b.risk-a.risk||a.id-b.id).slice(0,5);
  if(!flagged.length)$('inspect').append(text('p','No flagged windows for this model and threshold.'));
  for(const w of flagged){const b=text('button',`#${w.id} · ${w.risk.toFixed(3)}`);b.onclick=()=>inspect(w);$('inspect').append(b);}
 }catch(e){$('kpis').replaceChildren();$('inspect').replaceChildren();$('chart').replaceChildren(text('p',e.message));status(e.message,true);}
}
function percent(v){return Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'N/A';}
function draw(rows,threshold){
 const host=$('chart');host.replaceChildren();if(!rows.length){host.append(text('p','No test windows are available. Load test-period artifacts and refresh.'));return;}
 const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 150');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Risk timeline: ${rows.length} test windows`);
 const path=(d,color,width=1)=>{const e=document.createElementNS(ns,'path');e.setAttribute('d',d);e.setAttribute('stroke',color);e.setAttribute('fill','none');e.setAttribute('stroke-width',width);svg.append(e);return e;};
 let risk='',flags='';rows.forEach((w,i)=>{const x=10+i/Math.max(1,rows.length-1)*380,y=135-w.risk*120;const prev=rows[i-1];risk+=`${!prev||prev.sequence_id!==w.sequence_id||w.start_ts>prev.end_ts?'M':'L'}${x.toFixed(2)},${y.toFixed(2)} `;if(w.flagged)flags+=`M${x.toFixed(2)},${y.toFixed(2)}h.3 `;});
 path(risk,'#3b82f6',1.5);const f=path(flags,'#ef4444',3);f.setAttribute('stroke-linecap','round');const t=path(`M10,${135-threshold*120}H390`,'#94a3b8');t.setAttribute('stroke-dasharray','4 4');host.append(svg,text('p',`Risk 0–1 · Windows ${rows[0].id}–${rows.at(-1).id} · Threshold ${threshold.toFixed(3)}`,'muted'));
}
async function inspect(w){
 const token=++generation;current=w;$('detail').hidden=false;$('detail').replaceChildren(text('p',`Loading window #${w.id}…`));
 try{
  const detail=await request(`/windows/${w.id}`);if(token!==generation)return;
  const panel=$('detail');panel.replaceChildren(text('h2',`Window #${w.id} · selected model risk ${w.risk.toFixed(3)}`));
  const counts=text('dl','');for(const k of ['flows','bytes','packets'])counts.append(text('dt',k),text('dd',detail.counts?.[k]?.toLocaleString()??'N/A'));panel.append(counts);
  panel.append(text('p',`RF explanations and notes use the backend default model (${bundle.meta.default_model}), independent of the selector.`,'muted'));
  if(detail.top_features?.length)for(const f of detail.top_features)panel.append(text('p',`${f.name}: ${f.value} · SHAP ${Number(f.shap).toFixed(4)}`));else panel.append(text('p','No local SHAP explanation is available.','muted'));
  const b=text('button','Generate analyst note');const note=text('div','');note.id='note';panel.append(b,note);
  b.onclick=async()=>{b.disabled=true;note.replaceChildren(text('p','Generating local analyst note…'));try{const n=await request(`/windows/${w.id}/note`,{method:'POST'});if(token!==generation)return;note.replaceChildren(text('p',n.source==='gemma'?`Gemma · ${n.model}`:'Template fallback','badge'),text('h3','Threat summary'),text('p',n.threat_summary),text('h3','Why suspicious'),text('p',n.why_suspicious));const list=text('ul','');for(const check of n.suggested_checks||[])list.append(text('li',check));note.append(text('h3','Suggested checks'),list,text('p',n.caveat,'muted'));}catch(e){if(token===generation)note.replaceChildren(text('p',e.message));}finally{if(token===generation)b.disabled=false;}};
 }catch(e){if(token===generation){const retry=text('button','Retry window');retry.onclick=()=>inspect(w);$('detail').replaceChildren(text('p',e.message),retry);}}
}
$('retry').onclick=load;$('model').onchange=render;
for(const b of document.querySelectorAll('[data-page]'))b.onclick=()=>chrome.tabs.create({url:'http://127.0.0.1:5173'+b.dataset.page});
try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});let origin='Browser page';try{origin=new URL(tab?.url).origin;}catch{}$('site').textContent=`Browsing: ${origin} · context only`;}catch{$('site').textContent='Current tab context unavailable · console remains usable';}
load();
