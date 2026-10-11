import {request, project, validateNote} from './core.js';
import {currentSiteTab, expandDashboard, stopMonitoring, inspectSite} from './site-ui.js';
const $ = id => document.getElementById(id);
const text = (tag, value, cls) => {const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
let bundle, current, generation=0, loadGeneration=0, activeView='website';
function status(message, error=false) {$('status').textContent=message;$('status').className=error?'error':'';}
function loading(message) {status(message);const s=document.createElement('span');s.className='spinner';$('status').prepend(s);}
async function load() {
 const token=++loadGeneration;++generation;current=null;bundle=null;$('detail').hidden=true;$('results').hidden=true;loading(' Connecting to local Argus…');
 try {
  const [health,meta,windows,metrics]=await Promise.all(['/health','/meta','/timeline?split=test','/metrics'].map(p=>request(p)));
  if(token!==loadGeneration)return;
  if(!health.ok)throw new Error('Argus is not ready. Check the backend and retry.');
  if(!Array.isArray(windows)||!Array.isArray(metrics.models))throw new Error('Argus returned an unsupported data format. Refresh after checking the backend.');
  bundle={health,meta,windows,metrics};$('model').value=meta.default_model || 'rf';$('results').hidden=false;render();renderModels();
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
  for(const [label,value] of [['Test windows',rows.length.toLocaleString()],['Flagged',rows.filter(w=>w.flagged).length.toLocaleString()],['Precision',percent(metric.precision)],['Recall',percent(metric.recall)],['Onset recall',percent(metric.onset_recall)],['False-positive rate',percent(metric.fpr)]]) {
   const card=text('div','', 'kpi');card.append(text('strong',value),text('span',label));$('kpis').append(card);
  }
  draw(rows,threshold);$('inspect').replaceChildren();
  if(model==='rf' && threshold===0)$('inspect').append(text('p','RF threshold is zero: every test window is flagged. This is not selective operational alerting.','warning'));
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
 let truth='';rows.forEach((w,i)=>{if(w.truth_next===1){const x=10+i/Math.max(1,rows.length-1)*380;truth+=`M${x.toFixed(2)},15v120 `;}});const shade=path(truth,'rgba(239,68,68,0.08)',Math.max(.1,380/rows.length));shade.setAttribute('aria-label','Evaluation ground truth shading');
 path(risk,'#3b82f6',1.5);const f=path(flags,'#ef4444',3);f.setAttribute('stroke-linecap','round');const t=path(`M10,${135-threshold*120}H390`,'#94a3b8');t.setAttribute('stroke-dasharray','4 4');host.append(svg,text('p',`Risk 0–1 · Windows ${rows[0].id}–${rows.at(-1).id} · Threshold ${threshold.toFixed(3)}`,'muted'));
 host.append(text('p','Shaded periods: evaluation ground truth, unavailable during live prediction.','muted'));
}
async function inspect(w){
 const token=++generation;current=w;$('detail').hidden=false;$('detail').replaceChildren(text('p',`Loading window #${w.id}…`));
 try{
  const detail=await request(`/windows/${w.id}`);if(token!==generation)return;
  const panel=$('detail');panel.replaceChildren(text('h2',`Window #${w.id} · selected model risk ${w.risk.toFixed(3)}`));
  const counts=text('dl','');for(const k of ['flows','bytes','packets'])counts.append(text('dt',k),text('dd',detail.counts?.[k]?.toLocaleString()??'N/A'));panel.append(counts);
  panel.append(text('p',`RF explanations and notes use the backend default model (${bundle.meta.default_model}), independent of the selector.`,'muted'));
  const stage=text('p',`Stage: ${detail.evaluation_stage || 'Unavailable'} (dataset label, evaluation only)`);stage.title='Dataset label, evaluation only. Not a model prediction.';panel.append(stage);
  if(detail.top_features?.length){
   const features=[...detail.top_features].filter(f=>Number.isFinite(f.shap)).sort((a,b)=>Math.abs(b.shap)-Math.abs(a.shap)).slice(0,5),max=Math.max(1e-9,...features.map(f=>Math.abs(f.shap)));
   panel.append(text('h3','RF SHAP contributions'));
   for(const f of features){const row=text('div','','shap-row'),track=text('div','','shap-track'),bar=text('span','',f.shap>=0?'shap-positive':'shap-negative');bar.style.width=`${Math.abs(f.shap)/max*50}%`;bar.style.left=f.shap>=0?'50%':`${50-Math.abs(f.shap)/max*50}%`;track.append(bar);row.append(text('p',`${f.name}: ${f.value} · ${f.shap>=0?'+':''}${f.shap.toFixed(4)}`),track);panel.append(row);}
  }else panel.append(text('p','No local SHAP explanation is available.','muted'));
  const b=text('button','Generate analyst note');const note=text('div','');note.id='note';panel.append(b,note);
  b.onclick=async()=>{b.disabled=true;note.replaceChildren(text('p','Generating local analyst note…'));try{const response=await request(`/windows/${w.id}/note`,{method:'POST'});if(token!==generation)return;const n=validateNote(response,w.id);note.replaceChildren(text('p',n.source==='gemma'?`Gemma · ${n.model}`:'Template fallback','badge'),text('h3','Threat summary'),text('p',n.threat_summary),text('h3','Why suspicious'),text('p',n.why_suspicious));const list=text('ul','');for(const check of n.suggested_checks)list.append(text('li',check));note.append(text('h3','Suggested checks'),list,text('p',n.caveat,'muted'));}catch(e){if(token===generation)note.replaceChildren(text('p',e.message));}finally{if(token===generation)b.disabled=false;}};
 }catch(e){if(token===generation){const retry=text('button','Retry window');retry.onclick=()=>inspect(w);$('detail').replaceChildren(text('p',e.message),retry);}}
}
$('retry').onclick=load;$('model').onchange=render;
for(const b of document.querySelectorAll('[data-page]'))b.onclick=()=>chrome.tabs.create({url:'http://127.0.0.1:5173'+b.dataset.page});
function renderModels(){
 const models=bundle.metrics.models,host=$('models-table'),chart=$('models-chart');host.replaceChildren();chart.replaceChildren();
 if(!models.length){host.append(text('p','No model metrics are available. Check the artifact bundle and refresh.'));chart.append(text('p','No comparison chart can be drawn without metrics.'));$('comparison').textContent='Model comparison unavailable.';return;}
 const table=text('table',''),head=text('thead',''),header=text('tr','');
 for(const label of ['Model','PR-AUC','F1','Recall','Onset recall','FPR','Latency (ms)','Precision','Threshold'])header.append(text('th',label));head.append(header);table.append(head);
 const body=text('tbody','');
 for(const model of models){const row=text('tr','');for(const value of [model.name,decimal(model.pr_auc),decimal(model.f1),percent(model.recall),percent(model.onset_recall),percent(model.fpr),decimal(model.latency_ms_per_window),percent(model.precision),decimal(model.threshold)])row.append(text('td',value));body.append(row);}table.append(body);host.append(table);
 const rf=models.find(m=>m.name==='rf'),lr=models.find(m=>m.name==='lr_current');
 if(rf && lr)$('comparison').textContent=`RF ${compare(rf.pr_auc,lr.pr_auc)} lr_current on PR-AUC (${decimal(rf.pr_auc)} versus ${decimal(lr.pr_auc)}) and ${compare(rf.f1,lr.f1)} on F1 (${decimal(rf.f1)} versus ${decimal(lr.f1)}).`;
 else $('comparison').textContent='RF or lr_current metrics are missing; comparison is unavailable.';
 chart.append(text('h3','PR-AUC and F1 · scale 0–1'));
 for(const model of models){const row=text('div','','model-bars');row.append(text('strong',model.name));for(const [key,label] of [['pr_auc','PR-AUC'],['f1','F1']]){const line=text('div','','metric-bar');line.append(text('span',`${label} ${decimal(model[key])}`));if(Number.isFinite(model[key])){const track=text('div','','bar-track'),bar=text('span','',key==='f1'?'f1-bar':'auc-bar');bar.style.width=`${Math.max(0,Math.min(1,model[key]))*100}%`;track.append(bar);line.append(track);}row.append(line);}chart.append(row);}
}
function decimal(value){return Number.isFinite(value)?value.toFixed(4):'N/A';}
function compare(a,b){return !Number.isFinite(a)||!Number.isFinite(b)?'cannot be compared with':a>b?'beats':a<b?'trails':'ties';}
function showView(view){
 activeView=view;if(view!=='website')stopMonitoring();
 $('website-view').hidden=view!=='website';$('benchmark-shell').hidden=!['benchmark','models'].includes(view);$('benchmark-view').hidden=view!=='benchmark';$('models-view').hidden=view!=='models';$('about-view').hidden=view!=='about';
 $('site').hidden=view!=='website';
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
 if(['benchmark','models'].includes(view) && !bundle)load();
 if(view==='website')inspectSite();
}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>showView(b.dataset.view);
$('expand').onclick=expandDashboard;
$('inspect-current').onclick=()=>showView('website');
if(new URL(location.href).searchParams.get('expanded')==='1')document.body.classList.add('expanded');
try{const tab=await currentSiteTab();let origin='Browser page';try{origin=new URL(tab?.url).origin;}catch{}$('site').textContent=`Browsing: ${origin} · click Inspect website to check`;}catch{$('site').textContent='Current tab context unavailable · benchmark console remains usable';}
inspectSite();
