# ARGUS HANDOFF (read this first, then PRD.md)

## What this is
Argus (formerly "Vigil") is a local web console that scores the risk that the NEXT 10-second
window of network flows contains malicious activity. Full spec: PRD.md. Hackathon: 12 hours,
solo, open-innovation theme, starts ~8:00 PM IST on 10 Oct 2026.

## Hard rules (never break)
1. NO `git push` and no remote. Only the human creates `.push_unlocked`, after the official start.
   Never bypass `.git/hooks/pre-push` (no --no-verify, no editing the hook).
2. Local commits only, honest timestamps. Never backdate, rebase, or squash history.
3. Chronological split only. No random shuffling. No label/attack_cat/truth_* in model features.
4. Features for window t use only flows with available_ts <= end of window t.
5. Call outputs "risk score", never "probability". Always show oracle persistence as non-deployable.
6. Do not fabricate data, metrics, or dataset semantics. If a dataset fails the gate, say so.
7. Runtime must work offline.

## Environment
- Project: ~/argus. Use `source .venv/bin/activate` then `python3` (plain `python` is broken here).
- Deps pinned in requirements.lock.txt (already installed in .venv).
- Backend: FastAPI. Frontend: React + TypeScript + Vite + Recharts. Plain CSS if Tailwind blocks.

## Current state
- Scaffold exists: backend/, frontend/, ml/inspect_dataset.py, tests/, fixtures/, scripts/, Makefile.
- Local git repo on `main`, NO commits yet, NO remote. pre-push hook installed and verified.
- PRD.md still says "VIGIL" in places -> rename to ARGUS (grep -n -i vigil *.md).
- S0 dataset gate NOT yet run. Raw UNSW-NB15 files (UNSW-NB15_1..4.csv + NUSW-NB15_features.csv)
  not yet confirmed in data/raw/. The Kaggle training-set/testing-set CSVs are REJECTED
  (no timestamps, pre-split). Raw files have Stime/Ltime (epoch seconds) and are the target.

## S0 command
    python3 ml/inspect_dataset.py --dataset-dir data/raw --output docs/s0_inspection_report.json
Then write docs/DATA_DECISION.md from the report. Primary dataset passes only if: usable timestamps,
binary label, positive+negative windows in train/val/test, several attack-onset windows in val and test.
Fallbacks in order: CTU-13 (separate sequence_id per scenario), then FIXTURE MODE (synthetic, labelled as such).

## Scope (proposed defaults, human may change)
KEEP: S0 gate, chronological split, leakage tests, oracle persistence + lr_current + lr_lag + RF,
validation-selected thresholds, onset recall, SHAP for RF test alerts, Models page, About/limitations.
CUT: ATT&CK mapping, second dataset, CSV upload, live Gemma (keep deterministic template notes).
ADD AFTER Gate 1 only: timeline scrubber/playback on Dashboard; alert-budget slider on Models page.

## Plan and gates
- Gate 0 (~50 min): API + frontend + dashboard running from fixtures/.
- Gate 1 (hour 3): real data, real metrics, real dashboard, window detail, Models page, About page.
- Then: analyst template notes, hardening, README, 90-second demo script using real numbers.
- Blocked >15 min: report TASK / STATUS / BLOCKER / two options (smallest unblock, scope cut).

## Working style
- One agent works at a time on a given folder. ML agent owns ml/, configs/, data/, artifacts/, tests/ml/.
  Web agent owns backend/, frontend/, runtime/, tests/api/. Contract changes (PRD section 7/8) need
  the human's approval and a PRD edit first.
- After each task: run its acceptance check, then `git add -A && git commit -m "<task id>: <what>"`.
- Update the "Current state" section of this file before ending a session.
