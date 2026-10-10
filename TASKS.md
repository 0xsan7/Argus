# Argus task acceptance ledger

Source: PRD Section 12 (the Section 0 reference to Section 10 is a numbering typo). Tasks are not done until Astra independently reruns their acceptance checks.

| ID | Owner | Dependencies | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|---|---|
| A0 | Astra | — | Create repo skeleton, `.gitignore` (include `.push_unlocked`), dependency manifests/lockfiles if available, Makefile, README stub, and install the `pre-push` block hook from Section 0.1 (`make hooks`) | `make help`; no raw data/runtime cache tracked; direct pre-push hook execution exits nonzero with "push locked" while `.push_unlocked` is absent; never invoke a locked push | done | make help hooks; direct hook exit 1 with push locked; git check-ignore confirms secrets/raw/cache/unlock excluded; no remote |
| A1 | Astra | A0 | Add schema validators and minimal fixture artifacts matching Section 7 | schema tests pass | done | schema tests first failed on missing validator; now 4 tests and 10 malformed-bundle subtests pass |
| A2 | Astra | A0 | Run environment doctor: Python, Node, required imports, Ollama presence, dataset files | `make doctor` prints pass/warn without network calls | done | make doctor passes required imports, Node/npm, Ollama tag; dataset path verified; installed runtime Python 3.14.6, 3.12 execution not yet tested |
| S0 | Sol | A0 | Inspect preferred dataset first; produce `DATA_DECISION.md`; inspect fallback only if primary candidate fails | document satisfies Section 3.4 | pending | — |
| L0 | Luna | A1 | FastAPI fixture loader with `/health`, `/meta`, `/timeline`, `/windows/{id}`, `/metrics` | API tests pass | pending | — |
| L1 | Luna | L0 | React/Vite shell, proxy, Dashboard from fixtures | `npm run build`; timeline renders | pending | — |
| S1 | Sol | S0 | Primary-dataset adapter with normalized temporal contract | adapter test; valid labels; sequence IDs; timing semantics documented | pending | — |
| S2 | Sol | S1 | Windowing/features | all leakage/boundary tests pass | pending | — |
| S3 | Sol | S2 | Chronological split + `oracle_persistence` + `lr_current` + `lr_lag` | split assertions pass; validation metrics produced | pending | — |
| L2 | Luna | L1 | Window detail panel with SHAP empty/success states and evaluation labels | fixture window opens correctly | pending | — |
| L3 | Luna | L1 | Models page | four fixture models render | pending | — |
| L4 | Luna | L1 | About page shell | required limitation sections visible | pending | — |
| S4 | Sol | S3 | Random Forest with train-only imbalance handling | deterministic validation metrics | pending | — |
| S5 | Sol | S4 | Freeze config and run final test evaluation | `metrics.json` + `run_manifest.json` validate | pending | — |
| S6 | Sol | S5 | SHAP for selected test alerts + retrospective stage mapping if defensible + `timeline.json` | schemas pass; at least one real explanation if SHAP works | pending | — |
| A3 | Astra | S6,L2,L3,L4 | Switch `USE_FIXTURES=0`; integrate real artifacts | real dashboard + real models page load; `make test` green | pending | — |
| L5 | Luna | A3 | Ollama client + strict JSON parser + deterministic template fallback + runtime cache | mocked success, timeout, malformed JSON, connection error tests pass | pending | — |
| L6 | Luna | L5 | Note button and UI states | loading, Gemma, template fallback, error states visible | pending | — |
| A4 | Astra | L6 | Optional real Ollama smoke test | if available, one real note returns; failure does not break site | pending | — |
| S7 | Sol | A3 | Write real limitations + top false positives/negatives | `docs/LIMITATIONS.md` contains real examples | pending | — |
| L7 | Luna | A3 | Error/empty/loading audit | no blank charts or stack traces | pending | — |
| A5 | Astra | S7,L7 | Final README and offline run instructions | fresh terminal can run using existing local dependencies + pre-staged data | pending | — |
| A6 | Astra | A5 | Write 90-second demo script using actual numbers | script matches artifacts exactly | pending | — |
| A7 | Astra | A6 | Final test and demo rehearsal | core path works with Ollama off | pending | — |

## Gates
- Gate 0: pending — API, Vite and fixture timeline exercised in browser. No extra web features before this.
- Gate 1: pending — S0 passes, real pipeline generated artifacts, real core pages and tests pass.

## Safety interpretation
- Never invoke git push while locked, including tests. Exercise the installed pre-push executable directly and assert nonzero plus "push locked". This respects Section 0.1 over the conflicting A0 acceptance wording.
- unlock-push prints human-only instructions; agents must not script creation of the unlock file.
- Only human may unlock pushing; no automatic pushes afterwards.

## Preflight evidence
- User-approved setup-only dependency downloads; runtime stays offline.
- User dataset path: `/Users/santiagojerald/Desktop/dataset`.
- All work isolated in `/Users/santiagojerald/argus` (home itself is another Git repository; no home-level staging).
- Sol assigned S0 only; Luna assigned L0–L1 only. Further implementation waits for parent gate acceptance.
- PRD corrected Section 0 cross-references (tasks Section 12, ownership Section 11) and reconciled A0 hook test with hard no-push rule.
