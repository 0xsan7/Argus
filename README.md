# Argus

**Argus** is a local, privacy-first, one-window-ahead network risk-scoring and early-warning engine. It models chronological flow telemetry to predict attack risk in the *next* time window, computes local SHAP feature attributions, and provides local, air-gapped analyst notes using an on-device Gemma LLM without dataset ground-truth leakage.

---

## Prep vs Event Build

### 1. Prep Build (Pre-Event Skeleton & Tooling)
Built before the event to establish repository scaffolding, testing harnesses, and contract assertions:
- `0720cbd` `A0`: Rename Vigil to Argus and initialize project directory skeleton
- `f23da91` Update README repository metadata
- `20161e4` `S0`: Dataset inspection and decision framework
- `5f8f89e` `S0`: Parametrize `window_seconds` and evaluate chronological split semantics
- `d31da46` `S0`: Transition to 1-second window size and establish baseline configuration
- `ce99b77` `chore`: Test harness, contract schema validators, pre-push hook protections, and initial handoff

### 2. Event Build (Built Live During the Hackathon)
Everything from pipeline feature extraction to live model evaluation, API integration, and air-gapped LLM explanations was built during the event:
- **ML Pipeline & Predictive Models**:
  - `8b6906a` `S1`: UNSW-NB15 adapter with strict temporal semantics (`Stime` flow start vs `Ltime` observation boundary)
  - `25f4611` `S2`: Rolling window aggregation, lag features, target generation (`truth_next`), and boundary leakage tests
  - `ee7afe2` `S3`: Strict chronological partition (`train_end_ts`, `val_end_ts`, `test_start_ts`) and baseline models (`oracle_persistence`, `lr_current`, `lr_lag`)
  - `f2c7291` `S4`: Random Forest model with train-only class weighting
  - `25df238` `S5`: Test partition evaluation, confusion matrices, and `metrics.json` generation
  - `1de60fb` `S6`: SHAP feature importance extraction and final artifact bundle (`timeline.json`, `metrics.json`, `run_manifest.json`)
- **FastAPI Backend & React Dashboard**:
  - `a5a5228` `Gate 0`: Fixture-backed API routes and initial React/Vite dashboard shell
  - `5325da1` `TASK 1c`: Real artifact loading (`USE_FIXTURES=0`), interactive SVG timeline, flagged window KPIs, and SHAP modal inspection
- **Offline LLM Integration & Leakage Guards**:
  - `50b3511` `TASK 2a`: Ollama client with strict JSON validation, timeouts, and deterministic template fallback
  - `c2f492f` `TASK 2b`: LLM prompt builder with hard allowlist/denylist preventing ground-truth leakage
  - `dfcff65` `TASK 2c`: Robust local notes cache (`artifacts/notes_cache.json`) with corruption handling
  - `712c89d` `TASK 2d`: Analyst note endpoint (`POST /api/windows/{id}/note`) and unit test suite
  - `a84ceec` / `1f8b1de` `TASK 3` / `TASK I`: Detail modal analyst note panel with loading, Gemma, fallback, and error states
  - `b7662da` `TASK A`: Strict removal of ground truth from fallback notes
  - `084d74b` `TASK B`: Wire-level leakage test verifying raw HTTP payloads sent to Ollama
  - `21f3bd2` `TASK D`: Configurable Gemma timeout via `GEMMA_TIMEOUT_S` (default 60s)
  - `737e520` `TASK J`: Step-by-step 90-second demo script (`docs/DEMO.md`)

---

## How to Run

### 1. Prerequisites & Setup
Ensure Python 3.11+ and Node.js 18+ are available, then run:
```bash
make setup
```
*(Installs backend virtual environment requirements and frontend npm dependencies).*

### 2. Start the Backend API (Real Artifacts)
Launch the FastAPI server with real ML pipeline artifacts:
```bash
USE_FIXTURES=0 .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

### 3. Start the Frontend Dashboard
In a separate terminal, launch the Vite development server:
```bash
cd frontend && npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. (Optional) Run Local Gemma for Analyst Notes
If using live LLM inference instead of the deterministic template fallback:
```bash
ollama run gemma4:e2b-mlx
```

### 5. Running Tests
To run the full test suite (backend pytest + frontend production build):
```bash
make test
```

---

## Dataset Citation

> Moustafa, Nour, and Jill Slay. *"UNSW-NB15: a comprehensive data set for network intrusion detection systems (UNSW-NB15 network data set)."* 2015 Military Communications and Information Systems Conference (MilCIS). IEEE, 2015.

---

## Limitations

> **Limitations Note:** Evaluated on benchmark network flow traffic with an attack-dense chronological test partition (88.6% positive rate); real-world SOC deployment requires operational baseline re-calibration and continuous domain-specific adaptation.
