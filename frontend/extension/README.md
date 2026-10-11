# Argus Chrome extension

A Manifest V3 toolbar companion for the local Argus console. Open it while browsing any website to inspect historical network benchmark results, switch models, inspect flagged windows, and request local analyst notes. It does **not** scan, score, capture traffic from, or block the visited website. Browser request metadata cannot substitute for the flow features used by the trained model.

## Run and install

From `/Users/santiagojerald/argus`, start the real-data backend:

```sh
USE_FIXTURES=0 .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, start the full console (needed for the Open console, Models, and About buttons):

```sh
npm --prefix frontend run dev -- --port 5173
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `/Users/santiagojerald/argus/frontend/extension`.
4. Pin **Argus Local Console** from the extensions menu.
5. Visit a website and click the Argus toolbar icon.

No extension build, internet connection, account, or cloud API is required. After editing the extension, click Reload on its card in `chrome://extensions`, then reopen the popup. Closing the popup cancels its view; reopen it to refresh results.

## What to check

- A connected popup identifies the dataset/run and loads test windows.
- Change models: the risk line, threshold, flagged count, precision and recall change. Oracle persistence is explicitly non-deployable.
- Click a highest-risk window: counts and available RF SHAP features appear.
- Generate a note: its Gemma or Template fallback source, summary, rationale, checks, and caveat appear. Notes use the backend default model, independently of the selector. A Gemma badge can represent a cached note.
- Stop the backend and refresh: a readable connection message appears. Restart it and refresh to recover.
- Change websites and reopen: only the current origin is displayed as context. Website scores are never claimed.

## Permissions and data

`activeTab` grants temporary current-tab context when the user opens the popup. The popup displays the origin, without the path or query. It reads no page contents and injects no scripts. Localhost host permissions allow requests to the existing backend. Chrome host match patterns cover ports; the code uses only port 8000 for API calls and port 5173 for opening the full console. There are no remote hosts, analytics, background collectors, or stored browser history. No tab information is sent to Argus or Gemma.

The popup reads `/api/health`, `/api/meta`, `/api/timeline?split=test`, `/api/metrics`, and `/api/windows/{id}`. Analyst-note generation posts to `/api/windows/{id}/note`; backend cache/Gemma/fallback behavior stays unchanged. Keep the API bound to loopback.

## Tests

```sh
node --test frontend/tests/extension/extension.test.mjs
node frontend/tests/extension/browser.mjs
npm --prefix frontend test
npm --prefix frontend run build
```

The browser script uses an isolated temporary Brave profile because that installed Chromium-family browser supports loading unpacked extensions through automation. Set `EXTENSION_BROWSER` to another locally installed extension-capable Chromium executable if needed. No browser is downloaded. Chrome toolbar installation itself is a manual step above; the browser script tests the actual MV3 extension origin, not an ordinary web-page imitation.

The browser script uses the running real-data backend for timeline/model/detail checks. Gemma/fallback/error, empty, 503, disconnected, stale-response, and two website-context scenarios use controlled responses and are not benchmark measurements or real website scans. The live backend must contain the current 17,240-window Argus artifacts for the real-data assertion.
