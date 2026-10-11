// Cloudflare Pages advanced-mode gateway. All secrets stay server-side.
function failure(status, error) {
  return Response.json({error}, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const readRoute = /^\/api\/(health|meta|timeline|metrics|windows\/\d+)$/.test(url.pathname);
    const noteRoute = /^\/api\/windows\/\d+\/note$/.test(url.pathname);
    if (!readRoute && !noteRoute) return failure(404, 'Not found');
    if (request.method !== (noteRoute ? 'POST' : 'GET')) return failure(405, 'Method not allowed');
    let origin;
    try {
      origin = new URL(env.ARGUS_API_ORIGIN);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !env.ARGUS_API_TOKEN?.trim()) throw new Error();
    } catch { return failure(503, 'The online Argus backend is not configured.'); }
    if (noteRoute && env.ARGUS_ENABLE_NOTES !== 'true') return failure(503, 'Online analyst notes are disabled. Use the local console or ask the operator to enable notes.');
    const headers = new Headers({'Accept':'application/json','Authorization':`Bearer ${env.ARGUS_API_TOKEN}`});
    // Optional Cloudflare Access service credentials for a protected named tunnel.
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
      headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }
    try {
      const upstream = await fetch(origin.origin + url.pathname + url.search, {
        method:request.method, headers, redirect:'manual',
        signal:AbortSignal.timeout(noteRoute ? 75000 : 15000),
      });
      if (!upstream.ok) {
        if (upstream.status === 404) return failure(404, 'Window not found.');
        if (upstream.status === 422) return failure(422, 'Invalid evaluation request.');
        if (upstream.status === 503) return failure(503, 'The Argus artifact bundle is unavailable. Ask the operator to check the backend.');
        return failure(502, 'The Argus backend could not complete this request. Please retry.');
      }
      if (!upstream.headers.get('Content-Type')?.includes('application/json')) return failure(502, 'The Argus backend returned an unexpected response.');
      return new Response(upstream.body, {status:upstream.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    } catch { return failure(502, 'The Argus backend is offline or timed out. Ask the operator to restart the backend and Cloudflare Tunnel.'); }
  },
};
