import {analyzeSite, canInspect, collectPageSignals, inspectionError} from './site.js';
const $=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
let monitorTimer=null, busy=false, scanGeneration=0, pinnedTab=null;
const fixedTab=Number(new URL(location.href).searchParams.get('tab')) || null;
const bytes=n=>n==null?'Unavailable':n>=1024?`${(n/1024).toFixed(1)} KiB`:`${n} B`;
export async function currentSiteTab(){return fixedTab?await chrome.tabs.get(fixedTab):(await chrome.tabs.query({active:true,currentWindow:true}))[0];}
export function stopMonitoring(){clearInterval(monitorTimer);monitorTimer=null;pinnedTab=null;$('monitor').textContent='Start monitoring';}
export function inspectSite(){return inspect();}
function siteStatus(message,error=false){$('site-status').replaceChildren(text('span',message));$('site-status').className=error?'error':'';}
async function inspect(monitor=false){
 if(busy)return;
 if(!monitor)stopMonitoring();
 const token=++scanGeneration;busy=true;$('scan').disabled=true;
 if(!monitor)$('site-results').hidden=true;
 siteStatus(' Inspecting browser-visible signals…');$('site-status').prepend(text('span','','spinner'));
 try{
  const tab=monitor?await chrome.tabs.get(pinnedTab.id):await currentSiteTab();
  if(!tab || !canInspect(tab.url)){
   stopMonitoring();$('site-results').hidden=true;siteStatus('This page is restricted or unsupported. Open a normal HTTP or HTTPS website and click the Argus toolbar icon.',true);return;
  }
  const origin=new URL(tab.url).origin;
  if(monitor && origin!==pinnedTab.origin){stopMonitoring();$('site-results').hidden=true;siteStatus('The monitored tab changed websites. Reopen Argus on the new website and inspect again.',true);return;}
  const [injection]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:collectPageSignals});
  const after=await chrome.tabs.get(tab.id);
  if(!injection?.result || injection.result.origin!==origin || new URL(after.url).origin!==origin)throw new Error('Navigation changed during inspection');
  if(token!==scanGeneration)return;
  pinnedTab={id:tab.id,origin};
  const result=analyzeSite(injection.result);renderSite(result);$('site').textContent=`Website: ${origin}`;
  siteStatus(`${monitor && monitorTimer?'Monitoring · ':''}Snapshot ${new Date(result.capturedAt).toLocaleTimeString()} · ${origin}`);
 }catch(error){stopMonitoring();$('site-results').hidden=true;siteStatus(inspectionError(error),true);}
 finally{busy=false;$('scan').disabled=false;}
}
function renderSite(r){
 $('site-results').hidden=false;
 $('site-verdict').replaceChildren(text('p',r.origin),text('strong',`Security rule indicator ${r.indicator}/100 · ${r.verdict}`,r.indicator?'warning':''),text('p',r.caveat,'muted'));
 $('site-kpis').replaceChildren();
 for(const [label,value] of [['Retained requests',r.resources],['Cross-origin requests',r.externalRequests],['Observed HTTP errors',r.errors],['Page load',r.loadMs==null?'Not measured':`${Math.round(r.loadMs)} ms`],['Visible transfer',bytes(r.visibleBytes || null)],['Hidden/unknown statuses',r.unknownStatuses],['Median request duration',r.performance.medianMs==null?'Not measured':`${Math.round(r.performance.medianMs)} ms`],['P95 request duration',r.performance.p95Ms==null?'Not measured':`${Math.round(r.performance.p95Ms)} ms`],['HTTP error rate (known statuses)',r.performance.knownErrorRate==null?'Not measured':`${(r.performance.knownErrorRate*100).toFixed(1)}%`],['Completed requests over 1s',r.performance.slowRequests]]){
  const card=text('div','','kpi');card.append(text('strong',value),text('span',label));$('site-kpis').append(card);
 }
 const performanceHost=$('site-performance');performanceHost.replaceChildren();
 const performanceTable=text('table',''),performanceHead=text('thead',''),performanceHeader=text('tr','');
 for(const label of ['Measurement','This website','Demo budget','Result'])performanceHeader.append(text('th',label));performanceHead.append(performanceHeader);performanceTable.append(performanceHead);
 const performanceBody=text('tbody','');
 for(const check of r.performance.checks){const row=text('tr','');for(const value of [check.label,check.value,check.budget,{within:'Within budget',exceeded:'Over budget',unavailable:'Not measured',incomplete:'Incomplete coverage'}[check.status]])row.append(text('td',value));if(check.status==='exceeded')row.className='warning';performanceBody.append(row);}performanceTable.append(performanceBody);performanceHost.append(performanceTable,text('p',r.performance.caveat,'muted'));
 const host=$('site-chart');host.replaceChildren();
 if(!r.timeline.length)host.append(text('p','No retained resource requests yet. Interact with this website and inspect again, or start monitoring.'));
 else{
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 400 150');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${r.resources} observed resource requests over time`);
  const max=Math.max(1,...r.timeline.map(b=>b.count)),width=380/r.timeline.length;
  r.timeline.forEach((bin,i)=>{const bar=document.createElementNS(ns,'rect');bar.setAttribute('x',String(10+i*width));bar.setAttribute('y',String(135-bin.count/max*120));bar.setAttribute('width',String(Math.max(.5,width-2)));bar.setAttribute('height',String(bin.count/max*120));bar.setAttribute('fill','#3b82f6');const title=document.createElementNS(ns,'title');title.textContent=`${bin.second.toFixed(1)}s since navigation: ${bin.count} requests`;bar.append(title);svg.append(bar);});
  host.append(svg,text('p',`${r.bucketMs/1000}-second bins · starts ${r.timeline[0].second.toFixed(1)}s after navigation · retained HTTP resources, not network flow windows`,'muted'));
 }
 $('site-findings').replaceChildren();
 for(const f of r.findings){const row=text('div','','finding');row.append(text('strong',`${f.title} · +${f.points}`),text('p',f.detail));$('site-findings').append(row);}
 if(!r.findings.length)$('site-findings').append(text('p','No listed signals were observed in this snapshot. This is limited evidence, not a security guarantee.'));
 const origins=$('site-origins');origins.replaceChildren();
 if(!r.origins.length)origins.append(text('p','No HTTP resource origins are available in the retained timing buffer.'));
 else{
  const table=text('table',''),head=text('thead',''),header=text('tr','');for(const label of ['Origin','Count','Types','Visible bytes','HTTP errors'])header.append(text('th',label));head.append(header);table.append(head);const body=text('tbody','');
  for(const origin of r.origins){const row=text('tr','');for(const value of [origin.origin,origin.count,origin.types,bytes(origin.bytes),origin.errors])row.append(text('td',value));body.append(row);}table.append(body);origins.append(table);
 }
 $('site-coverage').textContent=`${r.coverage} ${r.omittedResources} resources, ${r.omittedOrigins} origins and ${r.omittedForms} forms omitted by display limits. Snapshots stay in this view and disappear when it closes.`;
}
$('scan').onclick=()=>inspect();
$('monitor').onclick=async()=>{
 if(monitorTimer){stopMonitoring();return;}
 if(busy)return;
 await inspect();if(!pinnedTab || $('site-results').hidden)return;
 $('monitor').textContent='Stop monitoring';monitorTimer=setInterval(()=>inspect(true),2000);
};
window.addEventListener('pagehide',()=>{++scanGeneration;stopMonitoring();});
export async function expandDashboard(){
 try{const tab=await currentSiteTab();await chrome.tabs.create({url:chrome.runtime.getURL(`popup.html?expanded=1${tab?.id?`&tab=${tab.id}`:''}`)});}catch{siteStatus('Could not open the expanded view. Reopen Argus on the website and try again.',true);}
}
