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

## Evaluation against PRD 3.2

**FAIL.** The dataset is rejected as the primary dataset because it fails to satisfy the hard requirements in PRD Section 3.2:
1.  Validation and test regions must contain *several* attack-onset windows (the operational minimum is 3, but here there is only 1 in val and 1 in test).
2.  No local source attribution/license/terms were supplied.

## Next Action
Proceed with `fixture_mode_no_training` as fallback.
