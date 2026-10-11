# Antideploy deployment

Application: `argus-console` at https://argus-console.antideploy.app.
Application ID is stored in the repository's `.antideploy.json`. The account credential is stored outside the repository in `~/.antideploy/config.json` with owner-only permissions. Revoke the connection at https://antideploy.com/tokens.

## Architecture

Antideploy builds the root Dockerfile. A Node build stage compiles the React/Vite frontend. A Python stage serves those static assets and the existing FastAPI routes together through `backend.app.web:app`, listening on `0.0.0.0:$PORT` (default 8080). Direct `/models` and `/about` links resolve to the frontend entry point. API responses remain JSON and use the real benchmark artifacts.

Only the three JSON files needed to serve the precomputed evaluation are shipped. Raw datasets, model binaries, training code, local tools, credentials, and analyst-note caches are excluded. No database, uploads bucket, sign-in service, email service, or paid cloud AI service is needed.

The public container does not reach Ollama on your laptop. Analyst notes therefore use the existing deterministic Template fallback. Local Gemma continues to work in the local console. This remains a benchmark-data experiment, not live website or production-network scanning.

## Configuration

The Dockerfile sets:

- `USE_FIXTURES=0`: real benchmark artifacts.
- `ARGUS_CORS_ORIGINS=`: no cross-origin browser API access; frontend/API share an origin.
- `ARGUS_WEB_DIST=/app/frontend/dist`: compiled frontend location.
- `NOTES_CACHE_PATH=/tmp/argus-notes-cache.json`: disposable cache, never immutable artifacts.
- `GEMMA_TIMEOUT_S=1`: prompt fallback if a local Ollama service is absent.

`PORT` is supplied by the host. Do not set `ARGUS_API_TOKEN` for this public same-origin deployment: that optional setting is for the separate authenticated Cloudflare Tunnel backend, not the public console.

The container runs as an unprivileged user. The web entry point adds security headers, disallows framing, restricts scripts/connections to the same origin, and hides internal exception details. The public benchmark API is intentionally readable without a login.

## Local checks

```sh
npm --prefix frontend run build
npm --prefix frontend test
.venv/bin/python -m pytest tests -q
ARGUS_CORS_ORIGINS='' NOTES_CACHE_PATH=runtime/antideploy-local-notes.json OLLAMA_MODEL=argus-deployment-unavailable-test GEMMA_TIMEOUT_S=1 .venv/bin/python -m uvicorn backend.app.web:app --host 127.0.0.1 --port 8002
```

In another terminal:

```sh
node frontend/scripts/test-deployment.mjs
```

The deliberately unavailable model name exercises Template fallback locally without turning off your normal Ollama service. To run the same browser checks against the live deployment:

```sh
ARGUS_DEPLOYMENT_URL=https://argus-console.antideploy.app node frontend/scripts/test-deployment.mjs
```

## Deploy again

```sh
python3 frontend/scripts/package-antideploy.py
```

The result is the complete deployable application archive at `runtime/argus-antideploy.tar.gz`, with runtime credentials and training inputs excluded. Upload it through Antideploy's authenticated `/api/v1/deploy?applicationId=...` API following https://antideploy.com/agent.md; never print the account token. Watch the returned task until it succeeds or fails, inspect errors/logs on failure, and verify the live URL and automatic security scan.

Deployment is a source archive upload, not a Git push. The repository's no-push policy remains intact. Cloudflare preparation files are retained locally from the earlier deployment target but are not included in the Antideploy archive or container.
