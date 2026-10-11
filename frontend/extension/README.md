# Argus Website Inspector — Chromium extension

A Manifest V3 extension for Chrome, Brave, and compatible Chromium browsers. It has two separate data sources:

- **Website:** automatically inspect the current HTTP/HTTPS page's browser-visible resource timing and transport/form signals when the extension opens. Runs locally without the backend. An explicit rule indicator is **not** an ML prediction, attack probability, vulnerability scan, or safety verdict.
- **Saved ML demo / Models:** the Argus historical UNSW-NB15 dashboard, all four models, full test-period timeline, KPIs, quick inspect, signed RF SHAP bars, and analyst notes. These scores do **not** describe the website you are browsing and intentionally stay unchanged between websites.

## Install in Chrome (about one minute)

1. Open `chrome://extensions` in Chrome, or `brave://extensions` in Brave.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select `/Users/santiagojerald/argus/frontend/extension`.
4. Pin **Argus Website Inspector** from the browser's extensions menu.
5. Visit a normal HTTP/HTTPS website, click its Argus toolbar icon, then click **Inspect website**.

If the old Argus extension is already installed, click **Reload** on its extension card and reopen the popup. Accept the added scripting permission if the browser asks. No extension compilation or account is required. A packaged copy is available at `/Users/santiagojerald/argus/runtime/argus-website-extension.zip`; extract it before Load unpacked.

## Test a website

Website inspection reads the **current top-level page** automatically when you invoke Argus from the toolbar, and again when you click Inspect website or return to the Website tab. It does not send probe traffic, submit forms, or scan the server.

1. Open the website normally and let it load.
2. Open Argus: the Website report is collected automatically. Click **Inspect website** to refresh it.
3. Review the rule indicator, findings, retained request count, cross-origin count, visible transfer sizes, available HTTP errors, page-load duration, median/P95 request duration, available HTTP error rate, request timeline, and origin table.
4. To watch updates while interacting, click **Expand dashboard**, then **Start monitoring**. Return to the original website and use it normally. The expanded view polls its browser-visible timing every two seconds. Click **Stop monitoring** when done.
5. After changing to a different website, open Argus from that website's toolbar icon again. Temporary page access does not transfer across origins. Monitoring stops and clears its results if its target changes origin, closes, or becomes inaccessible.

A zero indicator means only that the listed rules did not fire. It does not establish that the website is safe. Third-party requests and HTTP errors are observations, not proof of attacks.

The performance report compares actual measurements with explicitly chosen **demonstration budgets**: page load at most 3,000 ms, no observed completed requests exceeding 1,000 ms, at most 2,048 KiB of visible transfer, and at most 100 retained HTTP resources. These are not industry security standards or model accuracy benchmarks. Missing measurements show Not measured; hidden byte coverage shows Incomplete coverage unless the visible amount already exceeds the budget. Error rate divides observed HTTP errors by requests with known status only. Request duration statistics exclude zero/unknown timing.

Equal security-rule evidence legitimately gives equal rule scores across websites; the extension does not manufacture differences. Precision and recall require ground-truth labels and are not calculated for the website. Use **Show current website report** from the saved demo to return to the current website's measurements.

### Transparent rule indicator

Points are added once per rule, regardless of the number of affected elements, and capped at 100:

| Signal | Points |
|---|---:|
| Non-loopback page uses HTTP | 40 |
| HTTPS page references HTTP resources | 30 |
| Password form action uses HTTP | 35 |
| Other form action uses HTTP | 20 |

Loopback HTTP is labeled as development context. HTTPS alone is not proof of trust. HTTP references can be blocked or upgraded by the browser. A form action can be overridden by page scripts; this inspector reports the DOM action, without submitting it. Cross-origin password forms are shown for review with no score penalty because legitimate sign-in may use another origin.

### Coverage and privacy

The extension uses `activeTab` plus `scripting` for access granted by clicking the toolbar icon. It does not request permanent access to every website. Localhost host permissions serve the existing benchmark API.

Website snapshots stay in extension memory and disappear when the view closes. Only origins, resource types, counts, timing, available statuses/byte sizes, and boolean form signals are returned from the page. No page text, URL paths/query strings, password values, cookies, request/response bodies, or browsing history are collected or transmitted to Argus/Gemma. No analytics, remote scripts, or cloud service is used.

Coverage is limited to the top-level page and the latest 500 **retained** Performance API resource entries; the browser buffer can be smaller. Up to 100 forms and 20 origins are shown/analyzed as documented by the coverage text. Cross-origin timing can hide status/size; zero transfer can mean caching or unavailable information. Headers, WebSockets, nested-frame contents, server-side network flows, and attacks elsewhere in the network are unavailable. Browser-internal pages, extension pages, the Chrome Web Store, and file URLs are unsupported. The browser may restrict other special pages; the popup explains access failures.

This extension cannot use the existing Random Forest to score arbitrary browsing traffic: that model requires matching network-flow features and validation on an authorized collector's data.

## A reliable local presentation demo

Start the included **controlled test website**:

```sh
cd /Users/santiagojerald/argus
python3 frontend/scripts/serve-extension-demo.py
```

Open `http://127.0.0.1:8765` in Chrome:

1. Inspect the normal page: the rule indicator is zero, with a local-development caveat.
2. Click **Send 5 normal local requests** and inspect again: request count and timeline update.
3. Click **Send 3 controlled HTTP 503 responses** and inspect again: observed HTTP errors increase by three. These are deliberate demo responses, not attacks.
4. Open **Deliberate HTTP form issue** and inspect: the password-form finding adds 35 points. Do not enter real credentials; no submission is needed.
5. Use **Expand dashboard → Start monitoring**, then generate more local requests from the original page to see updates.

These website observations are real browser measurements of a controlled fixture. They are not benchmark performance results or evidence of live attack detection.

## Benchmark dashboard and notes

Website inspection needs no API. To use Benchmark and Models, start the real-data API:

```sh
cd /Users/santiagojerald/argus
USE_FIXTURES=0 NOTES_CACHE_PATH=runtime/notes_cache.json .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

For **Open web console**, also start:

```sh
npm --prefix /Users/santiagojerald/argus/frontend run dev -- --port 5173
```

Do not start another copy if those ports are already running.

- **Saved ML demo:** switch all four models; chart, threshold, flags and KPIs use the selected model. Shading is evaluation ground truth. Sequence gaps break the risk line. The current RF threshold is zero and flags all test windows; the extension states this limitation. The website origin is hidden in this view so it is not associated with saved scores.
- **Quick inspect:** select a window to see counts, signed RF SHAP bars when available, and stage context labeled evaluation-only.
- **Analyst note:** shows loading, Gemma or Template fallback, summary, rationale, checks, and caveat. Notes and SHAP use the backend default model independently of the selector. A Gemma note may be cached. Local Ollama is optional; website data is never part of this request.
- **Models:** table and PR-AUC/F1 bars for all four models, an actual metric-specific RF-versus-LR comparison, and a non-deployable oracle disclosure. Missing PR-AUC is N/A.
- **About:** method, dataset citation, chronological split, limitations, rule definitions, and claims policy, available even with the backend stopped.
- API errors, missing/empty data and loading are displayed with recovery instructions. Website checks continue when the backend is offline.

## Verification

```sh
cd /Users/santiagojerald/argus
npm --prefix frontend run test:extension
node frontend/tests/extension/site-browser.mjs
node frontend/tests/extension/browser.mjs
npm --prefix frontend test
npm --prefix frontend run build
```

The site browser test starts two local controlled sites and uses actual MV3 `chrome.scripting.executeScript` collection in an isolated Brave profile. It checks real resource requests, errors, form findings, navigation, monitoring, privacy, and offline behavior. Toolbar tab selection is controlled by the test; localhost host permission permits the injection. Manual toolbar invocation is the acceptance check for temporary `activeTab` grants on an arbitrary external HTTP/HTTPS website.

The benchmark browser test uses the running real-data backend for 17,240-window/model/detail checks. Note success/fallback/error and stale responses use explicitly controlled responses, not measured Gemma output. It also verifies internal Models/About navigation, comparison metrics, loading/empty/error states, and the web-console link. Set `EXTENSION_BROWSER` to another compatible installed Chromium executable if desired. No browser is downloaded.
