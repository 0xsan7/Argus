# Argus 90-Second Demo Script

A step-by-step presentation script using actual dataset partition metrics from `artifacts/metrics.json` and cached real-world anomaly windows from `artifacts/timeline.json`.

---

## Overview Timing

| Segment | Timing | Topic | Real Window / Metric Focus |
|---|---|---|---|
| **1. Hook & Overview** | `0:00 - 0:18` (18s) | The problem with lag & timeline overview | 17,240 test windows, 88.6% attack density |
| **2. The Baseline Trap** | `0:18 - 0:38` (20s) | Why persistence fails at onset | Oracle Persistence: 0% Onset Recall vs RF: 90.2% PR-AUC |
| **3. Anomaly Drilldown & SHAP** | `0:38 - 0:58` (20s) | Window inspection & feature explainability | Window #0 & Window #198 (Risk: 1.0, 46 flows) |
| **4. Gemma Analyst Note** | `0:58 - 0:78` (20s) | Fast local inference without ground-truth leakage | Pre-cached instant response, "Gemma" source badge |
| **5. Robustness & Wrap** | `0:78 - 0:90` (12s) | Graceful error handling & deployment readiness | Non-test Window #99999 safe handling |

---

## Step-by-Step Script

### Segment 1: Hook & Overview (0:00 – 0:18)
* **What to Click:** Open browser to `http://localhost:5173`. Scroll slightly to show the top KPI bar and the full test partition SVG timeline.
* **What to Say:**
  > "Traditional network intrusion detection alerts after the damage is done. Argus is an early-warning telemetry engine that predicts next-window risk before attacks establish a foothold.
  > Here on the dashboard, we evaluate a strictly chronological test partition of 17,240 one-second windows from UNSW-NB15 with zero lookahead leakage. The timeline visually separates clean baselines from sustained threat campaigns."
* **What the Judge Sees:**
  - KPI tiles showing `17,240` test windows, `177` flagged windows, and the benchmark warning badge `BENCHMARK DATA · NOT LIVE TRAFFIC`.
  - Full-width time-series chart showing risk probabilities over time.

---

### Segment 2: The Baseline Trap (0:18 – 0:38)
* **What to Click:** Click **"Models"** in the top navigation bar.
* **What to Say:**
  > "Many benchmarks cheat by evaluating simple persistence. Look at our ground-truth oracle persistence baseline: it achieves an apparent 88.8% F1, but its onset recall is exactly 0.0% — it misses every single initial attack window!
  > In contrast, our predictive models evaluate the transition. Random Forest delivers a 0.9024 PR-AUC and 100% onset recall with an average inference latency of just 16.5 milliseconds per window."
* **What the Judge Sees:**
  - The model comparison table displaying:
    - `oracle_persistence`: F1 `0.8885`, Onset Recall `0.0%`, TP `13,578`, FN `1,703`.
    - `rf`: PR-AUC `0.9024`, Recall `100.0%`, Onset Recall `100.0%`, Latency `16.53 ms`.
    - `lr_lag` & `lr_current`: PR-AUC `0.8956` & `0.8946`.

---

### Segment 3: Anomaly Drilldown & SHAP (0:38 – 0:58)
* **What to Click:** Navigate back to **"Dashboard"**. Under "Quick Inspect Flagged", click **"Flagged Window #0"** (or click a red risk peak on the chart).
* **What to Say:**
  > "When Argus flags a window, analysts don't just get a black-box probability. Opening Window #0, we see a risk score of 0.950.
  > Argus immediately computes local SHAP attributions. Here, the spike is driven by historical destination IP dispersion — `unique_dst_ip_lag2` with a +0.071 SHAP contribution — isolating concentrated destination probe behavior."
* **What the Judge Sees:**
  - Modal pops up titled `Window #0 Inspection`.
  - Risk header: `0.950 · FLAGGED` with sequence ID `seq-03`.
  - Top SHAP explanation bar chart featuring `unique_dst_ip_lag2` (value: 12.0), `unique_dst_ip`, and `unique_dst_ip_lag3`.
  - Raw flow metrics: 2,336 packets across a 1-second burst.

---

### Segment 4: Gemma Analyst Note (0:58 – 1:18)
* **What to Click:** Inside the modal, click the **"Generate analyst note"** button.
* **What to Say:**
  > "To eliminate analyst fatigue, Argus features an offline Gemma LLM integration. 
  > With one click, Gemma summarizes the threat, flags why it deviates from baseline, suggests tactical verification steps, and attaches a mandatory caveat.
  > Notice the badge: 'Gemma'. Notice also what's missing: the LLM prompt is strictly air-gapped from dataset ground truth like attack labels or stages. What you read is synthesized purely from telemetry and SHAP explanations."
* **What the Judge Sees:**
  - Instant transition from loading to formatted note card (served from pre-warmed cache).
  - Green `Gemma` model badge (`gemma4:e2b-mlx`).
  - Structured fields:
    - **Threat Summary**: High-volume burst of traffic across a 1-second window.
    - **Why Suspicious**: Low cardinality coupled with massive packet density.
    - **Suggested Checks**: Source/destination IP reputation check, firewall log correlation, protocol inspection.
    - **Caveat**: *"This analysis is based on automated heuristics; manual verification of the identified indicators is required."*

---

### Segment 5: Robustness & Wrap (1:18 – 1:30)
* **What to Click:** Close the modal. Click **"Train/Val Window #99999"** in the quick inspect bar.
* **What to Say:**
  > "Finally, Argus prevents partition bleed. Requesting out-of-core windows like #99999 fails safely with clear user notices instead of crashes.
  > Argus is private, 100% offline-capable, and ready for SOC early-warning deployment."
* **What the Judge Sees:**
  - Handled notice: *"Window #99999 not found in test partition (only test-partition windows are indexed in this timeline)."*
  - Clean UI, zero console errors, zero uncaught exceptions.
