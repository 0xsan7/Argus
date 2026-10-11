// This entire function is serialized by chrome.scripting. Keep it self-contained.
// Only origin-level summaries leave the page. Never read field values or bodies.
export function collectPageSignals() {
  const originOf = value => {
    try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) ? u.origin : null; }
    catch { return null; }
  };
  const resources = performance.getEntriesByType('resource');
  const nav = performance.getEntriesByType('navigation')[0];
  const insecure = value => { try { return new URL(value, location.href).protocol === 'http:'; } catch { return false; } };
  return {
    origin: location.origin, secureContext: window.isSecureContext,
    capturedAt: Date.now(), timeOrigin: performance.timeOrigin,
    navigation: { duration: nav?.loadEventEnd > 0 ? nav.loadEventEnd : null, responseStatus: nav?.responseStatus || null },
    resourceTotal: resources.length,
    resources: resources.slice(-500).map(r => ({
      origin: originOf(r.name), type: String(r.initiatorType || 'other').slice(0,40),
      start: r.startTime, duration: r.duration, transfer: r.transferSize || 0,
      status: r.responseStatus || 0,
    })).filter(r => r.origin),
    forms: Array.from(document.forms).slice(0,100).map(form => ({
      password: !!form.querySelector('input[type="password"]'),
      insecure: insecure(form.action || location.href),
      external: originOf(form.action || location.href) !== location.origin,
    })),
    formTotal: document.forms.length,
    insecureElements: location.protocol === 'https:' ? Array.from(document.querySelectorAll('script[src],link[rel="stylesheet"][href],iframe[src],img[src],audio[src],video[src]')).filter(e => insecure(e.src || e.href)).length : 0,
  };
}

export function canInspect(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.hostname !== 'chromewebstore.google.com' && !(url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));
  } catch { return false; }
}

export function inspectionError(error) {
  if (/Cannot access|permission|Missing host/i.test(error?.message || '')) return 'Page access is unavailable. Click the Argus toolbar icon on the website to grant temporary access, then try again. Browser and extension-store pages are restricted.';
  return 'Website inspection could not finish. The tab may have closed or navigated. Reopen Argus on the website and try again.';
}

export function analyzeSite(snapshot) {
  const url = new URL(snapshot.origin);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const findings = [];
  const add = (code, points, title, detail) => findings.push({code, points, title, detail});
  if (url.protocol === 'http:' && !loopback) add('http',40,'Page uses cleartext HTTP','The current page is not served over HTTPS. Network observers may read or modify traffic.');
  if (url.protocol === 'http:' && loopback) add('local',0,'Local development page','Loopback HTTP is shown as development context; it does not establish production transport security.');
  if (url.protocol === 'https:') add('https',0,'HTTPS page','The page URL uses HTTPS. This alone does not prove the website is trustworthy.');
  if (snapshot.insecureElements > 0) add('mixed-content',30,'HTTP resource references on an HTTPS page',`${snapshot.insecureElements} current resource references use HTTP. The browser may block or upgrade them; these are references, not proof of successful insecure loads.`);
  const passwordForms = snapshot.forms.filter(f => f.password && f.insecure).length;
  const otherForms = snapshot.forms.filter(f => !f.password && f.insecure).length;
  if (passwordForms) add('password-http',35,'Password form targets HTTP',`${passwordForms} password forms have a cleartext action URL. No values are read and no form is submitted.`);
  if (otherForms) add('form-http',20,'Form targets HTTP',`${otherForms} other forms target HTTP. No forms are submitted.`);
  const externalPasswordForms = snapshot.forms.filter(f => f.password && f.external).length;
  if (externalPasswordForms) add('external-form',0,'Password form submits to another origin',`${externalPasswordForms} forms use another origin. This may be intentional sign-in; verify the destination yourself.`);
  const resources = snapshot.resources;
  const groups = new Map();
  let errors=0, unknownStatuses=0, visibleBytes=0, externalRequests=0;
  for (const r of resources) {
    if (r.origin !== snapshot.origin) externalRequests++;
    if (r.status >= 400) errors++;
    if (!r.status) unknownStatuses++;
    visibleBytes += Math.max(0,r.transfer || 0);
    const group=groups.get(r.origin) || {origin:r.origin,count:0,bytes:null,types:new Set(),errors:0};
    group.count++;group.types.add(r.type);if(r.status>=400)group.errors++;
    if(r.transfer>0)group.bytes=(group.bytes || 0)+r.transfer;
    groups.set(r.origin,group);
  }
  const origins=Array.from(groups.values()).sort((a,b)=>b.count-a.count || a.origin.localeCompare(b.origin)).slice(0,20).map(g=>({...g,types:Array.from(g.types).join(', ')}));
  // At most 60 bins, including idle intervals. These are HTTP resource starts, not flow windows.
  const first=resources.length?Math.min(...resources.map(r=>r.start)):0;
  const last=resources.length?Math.max(...resources.map(r=>r.start)):0;
  const bucketMs=Math.max(1000,Math.ceil((last-first+1)/60/1000)*1000);
  const timeline=Array.from({length:resources.length?Math.floor((last-first)/bucketMs)+1:0},(_,i)=>({second:(first+i*bucketMs)/1000,count:0}));
  for(const r of resources)timeline[Math.floor((r.start-first)/bucketMs)].count++;
  const indicator=Math.min(100,findings.reduce((n,f)=>n+f.points,0));
  const durations=resources.map(r=>r.duration).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
  const medianMs=durations.length ? (durations[Math.floor((durations.length-1)/2)]+durations[Math.ceil((durations.length-1)/2)])/2 : null;
  const p95Ms=durations.length ? durations[Math.max(0,Math.ceil(durations.length*.95)-1)] : null;
  const unknownTransfers=resources.filter(r=>!(r.transfer>0)).length;
  const loadMs=Number.isFinite(snapshot.navigation.duration)&&snapshot.navigation.duration>0?snapshot.navigation.duration:null;
  const knownStatuses=resources.length-unknownStatuses;
  const performance={
    medianMs,p95Ms,slowRequests:durations.filter(n=>n>1000).length,
    measuredDurations:durations.length,knownStatuses,knownErrorRate:knownStatuses?errors/knownStatuses:null,
    checks:[
      {code:'load',label:'Page load',value:loadMs==null?'Not measured':`${Math.round(loadMs)} ms`,budget:'≤ 3,000 ms',status:loadMs==null?'unavailable':loadMs>3000?'exceeded':'within'},
      {code:'slow',label:'Completed requests over 1 second',value:durations.length?String(durations.filter(n=>n>1000).length):'Not measured',budget:'0 observed',status:!durations.length?'unavailable':durations.some(n=>n>1000)?'exceeded':'within'},
      {code:'transfer',label:'Visible transfer',value:visibleBytes?`${(visibleBytes/1024).toFixed(1)} KiB`:'Not measured',budget:'≤ 2,048 KiB',status:visibleBytes>2*1024*1024?'exceeded':!resources.length?'unavailable':unknownTransfers?'incomplete':'within'},
      {code:'requests',label:'Retained HTTP resources',value:String(resources.length),budget:'≤ 100',status:resources.length>100?'exceeded':'within'},
    ],
    caveat:'These are local demonstration performance budgets, not ML accuracy or industry security benchmarks. Only retained completed requests are measured; cached/cross-origin data can be incomplete.',
  };
  return {
    origin:snapshot.origin, capturedAt:snapshot.capturedAt, timeOrigin:snapshot.timeOrigin,
    indicator, verdict:indicator ? 'Listed exposure signals found' : 'No listed exposure signals observed', findings,
    resources:resources.length,externalRequests,errors,unknownStatuses,visibleBytes,
    loadMs,status:snapshot.navigation.responseStatus,performance,
    omittedResources:Math.max(0,snapshot.resourceTotal-resources.length),
    omittedOrigins:Math.max(0,groups.size-origins.length),
    omittedForms:Math.max(0,(snapshot.formTotal || snapshot.forms.length)-snapshot.forms.length),
    origins,timeline,bucketMs,
    caveat:'Rule-based browser exposure indicator, not the Argus network model, an attack probability, or a safety verdict. Zero does not mean safe.',
    coverage:'Top-level page only; retained completed Performance API resource entries (latest 500). In-flight requests are not counted. Cross-origin status/bytes may be hidden; zero transfer can mean caching or unavailable timing. No response headers, request bodies, cookies, form values, WebSocket traffic, or server-side flows are inspected.',
  };
}
