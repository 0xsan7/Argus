"""Local-only S0 measurements. Not an adapter, feature pipeline, or trainer."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


WINDOW_SECONDS = 10
LOOKBACK_WINDOWS = 5
MAX_GAP_WINDOWS = 60
MIN_MALICIOUS_FLOWS = 1


def inspect_timeline(frame: pd.DataFrame) -> dict:
    """Count targets from starts, observation bins from ends; never fit anything."""
    timing = frame[["Stime", "Ltime"]].to_numpy(dtype=np.float64)
    if not np.isfinite(timing).all():
        raise ValueError("Timestamps must be finite")
    if not np.equal(timing, np.floor(timing)).all():
        raise ValueError("This inspected packaging requires integer-second timestamps")
    if not frame["Label"].isin([0, 1]).all():
        raise ValueError("Labels must be binary 0/1")
    if (frame["Ltime"] < frame["Stime"]).any():
        raise ValueError("End timestamp precedes start timestamp")
    starts = frame["Stime"].to_numpy(dtype=np.int64)
    ends = frame["Ltime"].to_numpy(dtype=np.int64)
    labels = frame["Label"].to_numpy(dtype=np.int64)
    occupied = np.unique(np.concatenate([starts // WINDOW_SECONDS, ends // WINDOW_SECONDS]))
    cuts = np.flatnonzero(np.diff(occupied) - 1 > MAX_GAP_WINDOWS) + 1
    blocks = np.split(occupied, cuts)
    gaps = [{
        "previous_occupied_window_ts": int(occupied[c - 1] * WINDOW_SECONDS),
        "next_occupied_window_ts": int(occupied[c] * WINDOW_SECONDS),
        "idle_windows": int(occupied[c] - occupied[c - 1] - 1),
    } for c in cuts]
    sequences = []
    samples = []
    for sequence_index, bins in enumerate(blocks):
        first, last = int(bins[0]), int(bins[-1])
        lo, hi = first * WINDOW_SECONDS, (last + 1) * WINDOW_SECONDS
        start_mask = (starts >= lo) & (starts < hi)
        end_mask = (ends >= lo) & (ends < hi)
        truth = np.bincount(
            starts[start_mask] // WINDOW_SECONDS - first,
            weights=labels[start_mask], minlength=last - first + 1,
        ) >= MIN_MALICIOUS_FLOWS
        sequence_id = f"observed-{sequence_index:02d}"
        targets = np.arange(LOOKBACK_WINDOWS, len(truth))
        samples.extend((lo + int(t) * WINDOW_SECONDS, int(truth[t]), int(truth[t - 1])) for t in targets)
        sequences.append({
            "sequence_id": sequence_id, "start_ts": lo, "end_ts": hi,
            "first_start_ts": int(starts[start_mask].min()) if start_mask.any() else None,
            "last_start_ts": int(starts[start_mask].max()) if start_mask.any() else None,
            "first_available_ts": int(ends[end_mask].min()) if end_mask.any() else None,
            "last_available_ts": int(ends[end_mask].max()) if end_mask.any() else None,
            "start_rows": int(start_mask.sum()), "available_rows": int(end_mask.sum()),
            "windows": len(truth), "positive_windows": int(truth.sum()),
            "negative_windows": int((~truth).sum()), "eligible_samples": len(targets),
            "onsets_all": int((~truth[:-1] & truth[1:]).sum()),
            "source_files": {str(k): int(v) for k, v in frame.loc[start_mask, "source_file"].value_counts().sort_index().items()},
        })
    samples.sort()
    n = len(samples)
    train_end, val_end = n * 70 // 100, n * 80 // 100
    regions = {}
    for name, selected in zip(
        ("train", "validation", "test"),
        (samples[:train_end], samples[train_end:val_end], samples[val_end:]),
    ):
        positives = sum(row[1] for row in selected)
        regions[name] = {
            "samples": len(selected), "positive": positives,
            "negative": len(selected) - positives,
            "onsets": sum(row[1] == 1 and row[2] == 0 for row in selected),
            "continuations": sum(row[1] == 1 and row[2] == 1 for row in selected),
            "first_target_ts": selected[0][0] if selected else None,
            "last_target_ts": selected[-1][0] if selected else None,
        }
    return {
        "total_windows": sum(s["windows"] for s in sequences),
        "eligible_samples": n, "sequences": sequences, "regions": regions,
        "gaps": gaps,
    }


def inspect_local(dataset_dir: Path) -> dict:
    """Inspect every raw row in chunks; keep only temporal fields for S0 counts."""
    dataset_dir = dataset_dir.resolve(strict=True)
    inventory = []
    for path in sorted(p for p in dataset_dir.rglob("*") if p.is_file()):
        with path.open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
        inventory.append({"path": str(path), "size_bytes": path.stat().st_size, "sha256": digest})
    feature_path = dataset_dir / "NUSW-NB15_features.csv"
    definitions = pd.read_csv(feature_path, encoding="cp1252", keep_default_na=False)
    names = definitions["Name"].tolist()
    raw_files = []
    boundary_rows = []
    temporal_frames = []
    for path in sorted(dataset_dir.glob("UNSW-NB15_[1-4].csv")):
        with path.open(encoding="utf-8-sig", newline="") as file:
            first = next(csv.reader(file))
        if len(first) != len(names) or first == names:
            raise ValueError(f"Unexpected raw packaging: {path}")
        with path.open("rb") as file:
            bom = file.read(3) == b"\xef\xbb\xbf"
            # Inspected raw export is one physical line per flow, with short rows.
            file.seek(max(0, path.stat().st_size - 65536))
            last = list(csv.reader(file.read().decode("utf-8-sig").splitlines()))[-1]
        boundary_rows.append((first, last))
        dtypes = {name: set() for name in names}
        missing = {name: 0 for name in names}
        labels, categories = {}, {}
        rows = 0
        backwards_start = backwards_end = bad_order = mismatches = 0
        category_label_conflicts = 0
        max_duration = max_mismatch = 0.0
        min_start = min_end = None
        max_start = max_end = None
        prev_start = prev_end = first_start = first_end = None
        blank_ports = {name: 0 for name in ("sport", "dsport") if name in names}
        port_nonnumeric = {name: 0 for name in blank_ports}
        for chunk in pd.read_csv(path, header=None, names=names, encoding="utf-8-sig",
                                 chunksize=100_000, low_memory=False):
            rows += len(chunk)
            for name in names:
                dtypes[name].add(str(chunk[name].dtype))
                missing[name] += int(chunk[name].isna().sum())
            for name, output in (("Label", labels), ("attack_cat", categories)):
                for key, count in chunk[name].fillna("<empty>").value_counts().items():
                    key = str(key)
                    output[key] = output.get(key, 0) + int(count)
            s = chunk["Stime"].to_numpy(dtype=np.int64)
            e = chunk["Ltime"].to_numpy(dtype=np.int64)
            dur = chunk["dur"].to_numpy(dtype=np.float64)
            if first_start is None:
                first_start, first_end = int(s[0]), int(e[0])
            backwards_start += int((np.diff(s) < 0).sum()) + int(prev_start is not None and s[0] < prev_start)
            backwards_end += int((np.diff(e) < 0).sum()) + int(prev_end is not None and e[0] < prev_end)
            prev_start, prev_end = int(s[-1]), int(e[-1])
            min_start = int(s.min()) if min_start is None else min(min_start, int(s.min()))
            max_start = int(s.max()) if max_start is None else max(max_start, int(s.max()))
            min_end = int(e.min()) if min_end is None else min(min_end, int(e.min()))
            max_end = int(e.max()) if max_end is None else max(max_end, int(e.max()))
            discrepancy = np.abs(e - s - dur)
            mismatches += int((discrepancy > 1).sum())
            max_mismatch = max(max_mismatch, float(discrepancy.max()))
            max_duration = max(max_duration, float(dur.max()))
            bad_order += int((e < s).sum())
            category_present = chunk["attack_cat"].fillna("").str.strip().ne("")
            category_label_conflicts += int((category_present != chunk["Label"].eq(1)).sum())
            for name in blank_ports:
                blank_ports[name] += int(chunk[name].isna().sum())
                port_nonnumeric[name] += int((pd.to_numeric(chunk[name], errors="coerce").isna() & chunk[name].notna()).sum())
            temporal_frames.append(chunk[["Stime", "Ltime", "Label"]].assign(source_file=path.name))
        raw_files.append({
            "path": str(path), "header": False, "utf8_bom": bom, "rows": rows,
            "columns": [{"name": name, "observed_chunk_dtypes": sorted(dtypes[name]),
                         "missing": missing[name]} for name in names],
            "label_counts": dict(sorted(labels.items())), "attack_category_counts_raw": dict(sorted(categories.items())),
            "first_start_ts": first_start, "last_start_ts": prev_start,
            "first_end_ts": first_end, "last_end_ts": prev_end,
            "min_start_ts": min_start, "max_start_ts": max_start,
            "min_end_ts": min_end, "max_end_ts": max_end,
            "start_backward_steps": backwards_start, "end_backward_steps": backwards_end,
            "end_before_start": bad_order, "max_duration": max_duration,
            "duration_discrepancy_gt_one_second": mismatches,
            "max_abs_duration_discrepancy_seconds": max_mismatch,
            "category_label_conflicts": category_label_conflicts,
            "port_nonnumeric_nonmissing": port_nonnumeric,
        })
    if not temporal_frames:
        raise ValueError("No verified raw temporal candidate files found")
    timeline_frame = pd.concat(temporal_frames, ignore_index=True)
    timeline = inspect_timeline(timeline_frame)
    total_labels = {str(k): int(v) for k, v in timeline_frame["Label"].value_counts().sort_index().items()}
    static_files = []
    for path in sorted(dataset_dir.glob("UNSW_NB15_*-set.csv")):
        frame = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)
        static_files.append({
            "path": str(path), "rows": len(frame), "header": True,
            "columns": [{"name": name, "dtype": str(frame[name].dtype),
                         "missing": int(frame[name].isna().sum())} for name in frame.columns],
            "label_counts": {str(k): int(v) for k, v in frame["label"].value_counts().sort_index().items()},
            "attack_category_counts": {str(k): int(v) for k, v in frame["attack_cat"].value_counts().sort_index().items()} if "attack_cat" in frame else {},
            "usable_temporal_fields": [name for name in ("Stime", "Ltime", "start_ts", "end_ts", "timestamp") if name in frame],
            "decision": "rejected: static rows/IDs are not chronological timestamps",
        })
    events = {}
    events_path = dataset_dir / "UNSW-NB15_LIST_EVENTS.csv"
    if events_path.exists():
        frame = pd.read_csv(events_path, encoding="utf-8-sig", keep_default_na=False)
        total = frame["Attack subcategory"].str.strip().eq("Total")
        declared = int(frame.loc[total, "Number of events"].sum())
        events = {"path": str(events_path), "rows": len(frame), "declared_total": declared,
                  "raw_minus_declared": len(timeline_frame) - declared,
                  "category_counts": {str(k): int(v) for k, v in frame.loc[~total].groupby(frame.loc[~total, "Attack category"].str.strip())["Number of events"].sum().items()}}
    provenance_candidates = [item["path"] for item in inventory if any(
        token in Path(item["path"]).name.lower() for token in ("license", "licence", "readme", "citation", "terms", "source", "metadata")
    )]
    blockers = []
    for name, region in timeline["regions"].items():
        if not region["positive"] or not region["negative"]:
            blockers.append(f"{name}: lacks both positive and negative targets")
        if name != "train" and region["onsets"] < 3:
            blockers.append(f"{name}: only {region['onsets']} onset(s); fewer than several (operational minimum 3)")
    blockers.append("Local source attribution/license/terms require human verification" if provenance_candidates else "No local source attribution/license/terms supplied")
    return {
        "inspection_version": 1, "dataset_dir": str(dataset_dir),
        "config": {"window_seconds": WINDOW_SECONDS, "lookback_windows": LOOKBACK_WINDOWS,
                   "max_gap_windows": MAX_GAP_WINDOWS, "min_malicious_flows": MIN_MALICIOUS_FLOWS,
                   "split_fractions": [0.7, 0.1, 0.2], "availability": "Ltime",
                   "truth_time": "Stime", "alignment": "floor(first observed timestamp / 10) * 10 per sequence",
                   "split_assignment": "chronological eligible target timestamps; floor(0.7*N), floor(0.8*N)"},
        "inventory": inventory,
        "feature_definitions": definitions.to_dict(orient="records"),
        "raw_files": raw_files, "raw_total_rows": len(timeline_frame), "raw_label_counts": total_labels,
        "timeline": timeline, "static_files": static_files, "events": events,
        "file_boundary_checks": [{
            "left": Path(left["path"]).name, "right": Path(right["path"]).name,
            "end_timestamp_difference_seconds": right["first_end_ts"] - left["last_end_ts"],
            "start_range_overlap_seconds": max(0, left["max_start_ts"] - right["min_start_ts"]),
            "exact_boundary_row_duplicate": boundary_rows[i][1] == boundary_rows[i + 1][0],
        } for i, (left, right) in enumerate(zip(raw_files[:-1], raw_files[1:]))],
        "local_provenance": {"candidates": provenance_candidates, "terms_status": "unresolved",
                             "source": "user-provided local directory; original acquisition URL and citation absent/unverified"},
        "fallback_local_candidates": [item["path"] for item in inventory if any(
            token in Path(item["path"]).name.lower() for token in ("ctu", "luflow")
        )],
        "gate": {"status": "rejected", "selected_primary": None, "blockers": blockers,
                 "next_action": "fixture_mode_no_training"},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--window-seconds", type=int, default=10)
    args = parser.parse_args()
    global WINDOW_SECONDS
    WINDOW_SECONDS = args.window_seconds
    report = inspect_local(args.dataset_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.output.resolve()), "rows": report["raw_total_rows"],
                      "regions": report["timeline"]["regions"], "gate": report["gate"]}, indent=2))


if __name__ == "__main__":
    main()
