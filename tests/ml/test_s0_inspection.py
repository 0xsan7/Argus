"""S0 diagnostic tests; synthetic examples are not benchmark records."""
from importlib import util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "ml" / "inspect_dataset.py"


def inspection_module():
    assert SCRIPT.is_file(), "S0 inspection implementation is missing"
    spec = util.spec_from_file_location("s0_inspection", SCRIPT)
    module = util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_targets_require_five_history_windows_and_are_split_by_target_time():
    # Unsorted arrivals; final values are not available until end, not start.
    frame = pd.DataFrame({
        "Stime": np.arange(25) * 10,
        "Ltime": np.arange(25) * 10 + 9,
        "Label": [int(i % 2 == 0) for i in range(25)],
        "source_file": ["synthetic.csv"] * 25,
    }).iloc[::-1]
    report = inspection_module().inspect_timeline(frame)
    assert report["total_windows"] == 25
    assert report["eligible_samples"] == 20
    assert report["regions"]["train"] == {
        "samples": 14, "positive": 7, "negative": 7, "onsets": 7,
        "continuations": 0, "first_target_ts": 50, "last_target_ts": 180,
    }
    assert report["regions"]["validation"]["samples"] == 2
    assert report["regions"]["validation"]["first_target_ts"] == 190
    assert report["regions"]["test"]["first_target_ts"] == 210
    assert report["sequences"][0]["first_available_ts"] == 9
    assert report["sequences"][0]["available_rows"] == 25


def test_more_than_sixty_idle_windows_resets_history_but_sixty_does_not():
    # bins 0 and 61 have exactly sixty missing bins; bins 61 and 123 have 61.
    frame = pd.DataFrame({
        "Stime": [0, 610, 1230, 1240, 1250, 1260, 1270, 1280],
        "Ltime": [0, 610, 1230, 1240, 1250, 1260, 1270, 1280],
        "Label": [0, 1, 1, 0, 0, 0, 0, 1],
        "source_file": ["synthetic.csv"] * 8,
    })
    report = inspection_module().inspect_timeline(frame)
    assert [s["windows"] for s in report["sequences"]] == [62, 6]
    assert [s["eligible_samples"] for s in report["sequences"]] == [57, 1]
    assert report["gaps"] == [{
        "previous_occupied_window_ts": 610,
        "next_occupied_window_ts": 1230,
        "idle_windows": 61,
    }]
    assert report["regions"]["test"]["last_target_ts"] == 1280


def test_local_inspection_reads_headerless_bom_files_and_rejects_static_split(tmp_path):
    import csv
    import json
    import subprocess
    import sys

    root = tmp_path / "source"
    root.mkdir()
    columns = ["srcip", "dur", "Stime", "Ltime", "attack_cat", "Label"]
    with (root / "NUSW-NB15_features.csv").open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["No.", "Name", "Type ", "Description"])
        for i, name in enumerate(columns, 1):
            writer.writerow([i, name, "test", "synthetic description"])
    for part in range(1, 5):
        with (root / f"UNSW-NB15_{part}.csv").open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.writer(file)
            for i in range((part - 1) * 10, part * 10):
                label = int(i % 2 == 0)
                writer.writerow(["test-ip", 1.0, i * 10, i * 10 + 1,
                                 " TestAttack " if label else "", label])
    (root / "UNSW_NB15_training-set.csv").write_text("id,label\n1,0\n2,1\n")
    (root / "UNSW-NB15_LIST_EVENTS.csv").write_text(
        "Attack category,Attack subcategory,Number of events\nnormal,,20\nTestAttack,,20\n,Total ,40\n"
    )
    out = tmp_path / "inspection.json"
    result = subprocess.run([sys.executable, str(SCRIPT), "--dataset-dir", str(root),
                             "--output", str(out)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert out.exists(), "CLI must write the inspection report, not just exit successfully"
    report = json.loads(out.read_text())
    assert report["raw_total_rows"] == 40
    assert report["raw_label_counts"] == {"0": 20, "1": 20}
    assert report["raw_files"][0]["header"] is False
    assert report["raw_files"][0]["utf8_bom"] is True
    assert report["raw_files"][0]["columns"][2]["name"] == "Stime"
    assert report["timeline"]["eligible_samples"] == 35
    assert report["static_files"][0]["usable_temporal_fields"] == []
    assert report["static_files"][0]["label_counts"] == {"0": 1, "1": 1}
    assert report["local_provenance"]["terms_status"] == "unresolved"
    assert report["gate"]["selected_primary"] is None
    assert report["gate"]["next_action"] == "fixture_mode_no_training"
    assert report["events"]["declared_total"] == 40
    assert report["events"]["raw_minus_declared"] == 0
    assert all(not item["exact_boundary_row_duplicate"] for item in report["file_boundary_checks"])

    # Reproduce an overlapping export seam without deleting or inventing rows.
    first_raw = root / "UNSW-NB15_1.csv"
    second_raw = root / "UNSW-NB15_2.csv"
    last_row = list(csv.reader(first_raw.open(encoding="utf-8-sig")))[-1]
    remaining = list(csv.reader(second_raw.open(encoding="utf-8-sig")))
    with second_raw.open("w", encoding="utf-8-sig", newline="") as file:
        csv.writer(file).writerows([last_row] + remaining)
    rereport = inspection_module().inspect_local(root)
    assert rereport["file_boundary_checks"][0]["exact_boundary_row_duplicate"] is True
    assert rereport["raw_total_rows"] == 41
    assert rereport["events"]["raw_minus_declared"] == 1


@pytest.mark.parametrize("field,value,message", [
    ("Label", 2, "binary"),
    ("Stime", float("nan"), "finite"),
    ("Stime", 0.5, "integer-second"),
    ("Ltime", -1, "precedes"),
])
def test_invalid_timing_or_labels_are_rejected_not_repaired(field, value, message):
    frame = pd.DataFrame({"Stime": [0.0, 10.0], "Ltime": [1.0, 11.0],
                          "Label": [0, 1], "source_file": ["synthetic.csv"] * 2})
    frame.loc[0, field] = value
    with pytest.raises(ValueError, match=message):
        inspection_module().inspect_timeline(frame)
