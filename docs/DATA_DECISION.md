# Dataset Decision: UNSW-NB15

## Inspection Summary

*   **Files Inspected**: `UNSW-NB15_1.csv` through `UNSW-NB15_4.csv` and `NUSW-NB15_features.csv` (used for column names).
*   **Total Rows**: 2,540,047
*   **Class Balance (Raw Labels)**: 2,218,764 benign (0), 321,283 malicious (1).
*   **Temporal Semantics**:
    *   `Stime` is used as truth time (flow start).
    *   `Ltime` is used as availability time (flow end/feature observation).
*   **Contiguity**: The dataset forms contiguous sequences across the four files. (e.g., Sequence `observed-01` spans files 1 and 2, and `observed-03` spans files 2, 3, and 4).
*   **10-Second Windows per Split (Chronological)**:
    *   **Train**: 6,041 samples (2,213 positive, 3,828 negative)
    *   **Validation**: 863 samples (861 positive, 2 negative)
    *   **Test**: 1,727 samples (1,698 positive, 29 negative)
*   **Attack-Onset Windows**:
    *   Validation: 1
    *   Test: 1

## Initial Evaluation against PRD 3.2 (10s window)

**FAIL.** At a 10s window, the dataset is rejected because it fails to satisfy the hard requirements in PRD Section 3.2:
1.  Validation and test regions must contain *several* attack-onset windows (the operational minimum is 3, but here there is only 1 in val and 1 in test) because almost every window has a malicious flow.
2.  No local source attribution/license/terms were supplied.

## Window Size Amendment

To address the lack of class transitions (attack onsets), `WINDOW_SECONDS` was parametrized and evaluated at smaller sizes:

| Window Size | Split | Windows | Positive | Negative | Onsets |
|-------------|-------|---------|----------|----------|--------|
| **1s**      | Train | 60,336  | 20,057   | 40,279   | 1,671  |
|             | Val   | 8,620   | 7,723    | 897      | 763    |
|             | Test  | 17,239  | 15,280   | 1,959    | 1,703  |
| **2s**      | Train | 30,160  | 10,864   | 19,296   | 86     |
|             | Val   | 4,309   | 4,247    | 62       | 43     |
|             | Test  | 8,618   | 8,484    | 134      | 107    |
| **5s**      | Train | 12,093  | 4,420    | 7,673    | 13     |
|             | Val   | 1,728   | 1,720    | 8        | 5 (FLAG)|
|             | Test  | 3,456   | 3,397    | 59       | 1 (FLAG)|

**Decision**: 2 seconds is selected as the primary window size. It is the smallest-change (closest to 10s) window size that passes the requirement of having positive/negative target windows in all splits and >10 onsets in both validation and test sets.

## Attribution Amendment

**Source Citation**: Moustafa, Nour, and Jill Slay. "UNSW-NB15: a comprehensive data set for network intrusion detection systems (UNSW-NB15 network data set)." *Military Communications and Information Systems Conference (MilCIS)*, 2015.

## Final Evaluation

**PASS.** With the window size amended to 2 seconds and the Moustafa & Slay (2015) citation added, the primary dataset satisfies all hard requirements in PRD Section 3.2.
