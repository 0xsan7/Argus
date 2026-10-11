# Deploy Argus to Cloudflare Pages + local Cloudflare Tunnel

Architecture: browser → Cloudflare Pages `/api/*` gateway → HTTPS Cloudflare Tunnel → token-protected FastAPI on `127.0.0.1:8001` → local artifacts/Ollama. The existing development console continues to use port 8000. The deployed frontend has no tunnel URL or secrets embedded in its JavaScript.

The site remains a historical UNSW-NB15 benchmark demo. This deployment does not turn it into a live network or website scanner. Frontend hosting is online; API data and notes depend on this computer remaining awake with both backend and tunnel running.

## 1. Start the deployment backend

From the repository root:

```sh
.venv/bin/python frontend/scripts/serve-tunnel-backend.py
```

This starts a separate backend on port 8001, selects real artifacts (`USE_FIXTURES=0`), and stores the note cache under ignored `runtime/`. On its first run it generates a secret in `runtime/cloudflare-api-token.txt` with owner-only file permissions. Do not commit or share that file. Set the matching secret in Cloudflare as described below. Without the token the deployment API returns 401; the existing local API remains unchanged.

## 2. Start Cloudflare Tunnel

For a temporary demonstration, using the official locally downloaded client:

```sh
runtime/tools/cloudflared tunnel --url http://127.0.0.1:8001 --no-autoupdate
```

If cloudflared is installed on your PATH, use `cloudflared` instead. Keep this terminal running. Copy the generated HTTPS `trycloudflare.com` origin into the Pages `ARGUS_API_ORIGIN` variable. A Quick Tunnel URL changes when restarted; update the Pages variable and redeploy after a change. Quick Tunnels are for testing, without an uptime guarantee.

For a lasting URL, create a named tunnel in your Cloudflare account, route a hostname you control to `http://127.0.0.1:8001`, and run its connector. Do not point the tunnel at unauthenticated port 8000 or Ollama port 11434. The existing Cloudflare WARP app is not a substitute for the cloudflared connector.

## 3. Build and package

```sh
npm --prefix frontend run build
python3 frontend/scripts/package-pages.py
```

Upload package: `runtime/argus-cloudflare-pages.zip`. It contains the compiled frontend, security headers, API routing rules, and advanced-mode `_worker.js`. It does not contain artifacts, raw data, Python, node_modules, the extension, or credentials.

## 4. Create the Pages deployment

Sign in at https://dash.cloudflare.com/ and select **Workers & Pages → Create application → Pages → Direct Upload / Upload assets**. Choose an available project name, upload `runtime/argus-cloudflare-pages.zip`, and deploy.

The initial upload can show an API error until the backend bindings have been saved and a fresh deployment made. The direct-upload package includes `_worker.js`, which Cloudflare supports for dashboard uploads. A `functions/` source directory alone would not work through drag-and-drop.

Under the Pages project's **Settings → Variables and Secrets**, configure the production environment:

| Name | Type | Value |
| --- | --- | --- |
| `ARGUS_API_ORIGIN` | Variable | The tunnel HTTPS origin, with no `/api` suffix |
| `ARGUS_API_TOKEN` | Secret | Contents of local `runtime/cloudflare-api-token.txt` |
| `ARGUS_ENABLE_NOTES` | Variable | `false` initially; set `true` to permit local Gemma/template note requests |

Re-upload the same build as a new deployment after changing bindings so they take effect. Set preview bindings separately if you use preview deployments. Never prefix secrets with `VITE_`.

Online notes are disabled by default to avoid exposing expensive local model generation on an unrestricted public demo. Before enabling them, restrict demo access or configure Cloudflare rate limiting for `/api/windows/*/note`. Gemma remains local and template fallback still works if Ollama is unavailable. The public Pages gateway only proxies known read endpoints and the optional note endpoint; visitor cookies and authorization headers are never forwarded.

If a named tunnel is additionally protected with Cloudflare Access, configure a Service Auth policy and store its service-token values as Pages secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. These are separate from the Argus backend token.

For Git integration later: root directory `frontend`, build command `npm run build`, output directory `dist`. No push is needed for Direct Upload. The repository push policy remains in effect.

## 5. Verify online

- `/api/health`: returns `ok: true`, `artifacts: true`, and `mode: artifacts`.
- `/`: loads the real 17,240 test windows and four working model selections.
- `/models` and `/about`: open directly and through navigation.
- Inspect a flagged window: counts and available SHAP features appear.
- With notes enabled: generate a note and check the Gemma/Template source badge and all note fields. A Gemma badge may represent a cached note.
- Stop the tunnel: frontend remains available and API views show readable errors; restart and retry to recover.
- A direct unauthenticated request to the tunnel's `/api/meta` must return 401.

The extension remains a localhost companion. A Pages deployment does not update the extension's host permissions or backend URLs.

## Local verification

```sh
npm --prefix frontend test
.venv/bin/python -m pytest tests -q
npm --prefix frontend run build
```

The gateway tests use controlled upstream responses and are not benchmark results. The browser deployment check maps the HTTPS upstream to the real local authenticated API, serves the production `dist` files with the configured headers, and checks direct routes/model changes. It is a local compatibility check, not proof of a live Cloudflare deployment.

References: [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Cloudflare Tunnel downloads](https://developers.cloudflare.com/tunnel/downloads/), [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/).
