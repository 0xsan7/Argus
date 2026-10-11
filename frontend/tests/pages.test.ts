import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const load = async () => {
 const source = readFileSync('public/_worker.js', 'utf8')
 return import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
const configured = { ARGUS_API_ORIGIN: 'https://backend.example', ARGUS_API_TOKEN: 'test-secret' }
describe('Cloudflare Pages API gateway', () => {
 it('fails clearly before configuring the backend', async () => {
  const worker = (await load()).default
  const response = await worker.fetch(new Request('https://argus.pages.dev/api/meta'), {}, {})
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({error:'The online Argus backend is not configured.'})
 })
 it('proxies approved requests and query strings without forwarding visitor credentials', async () => {
  const upstream = vi.fn(async () => new Response(JSON.stringify({run_id:'controlled'}), {headers:{'Content-Type':'application/json','Set-Cookie':'unsafe=1'}}))
  vi.stubGlobal('fetch', upstream)
  try {
   const worker = (await load()).default
   const response = await worker.fetch(new Request('https://argus.pages.dev/api/timeline?split=test', {headers:{Cookie:'visitor-secret=1',Authorization:'Bearer visitor'}}), configured, {})
   expect(response.status).toBe(200)
   const [url, options] = upstream.mock.calls[0] as unknown as [string, RequestInit]
   expect(url).toBe('https://backend.example/api/timeline?split=test')
   expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-secret')
   expect(new Headers(options.headers).has('Cookie')).toBe(false)
   expect(response.headers.has('Set-Cookie')).toBe(false)
   expect(response.headers.get('Cache-Control')).toBe('no-store')
  } finally { vi.unstubAllGlobals() }
 })
 it('does not proxy arbitrary endpoints, insecure origins or disabled note generation', async () => {
  const worker = (await load()).default
  expect((await worker.fetch(new Request('https://argus.pages.dev/api/admin'), configured, {})).status).toBe(404)
  expect((await worker.fetch(new Request('https://argus.pages.dev/api/meta'), {...configured,ARGUS_API_ORIGIN:'http://localhost:8000'}, {})).status).toBe(503)
  expect((await worker.fetch(new Request('https://argus.pages.dev/api/windows/1/note',{method:'POST'}), configured, {})).status).toBe(503)
 })
 it('sanitizes upstream failures and unreachable backends', async () => {
  const worker = (await load()).default
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('Traceback secret',{status:500})))
  const error = await worker.fetch(new Request('https://argus.pages.dev/api/meta'), configured, {})
  expect(error.status).toBe(502)
  expect(JSON.stringify(await error.json())).not.toContain('Traceback')
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('private host')}))
  const offline = await worker.fetch(new Request('https://argus.pages.dev/api/meta'), configured, {})
  expect(offline.status).toBe(502)
  vi.unstubAllGlobals()
 })
 it('serves static pages through the Pages assets binding', async()=>{
  const worker=(await load()).default
  const assets={fetch:vi.fn(async()=>new Response('app'))}
  const response=await worker.fetch(new Request('https://argus.pages.dev/models'),{ASSETS:assets},{})
  expect(await response.text()).toBe('app')
 })
})
