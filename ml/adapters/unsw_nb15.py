import pandas as pd
import numpy as np
import yaml
from pathlib import Path

def load_unsw_nb15(dataset_dir: str | Path, config_path: str | Path = "configs/default.yaml") -> pd.DataFrame:
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    window_seconds = config.get("window_seconds", 1)
    max_gap_windows = config.get("max_gap_windows", 60)

    dataset_dir = Path(dataset_dir)
    features_path = dataset_dir / "NUSW-NB15_features.csv"
    
    features_df = pd.read_csv(features_path, encoding="cp1252")
    col_names = features_df["Name"].str.strip().tolist()

    raw_files = sorted(dataset_dir.glob("UNSW-NB15_*.csv"))
    if not raw_files:
        raise ValueError("No files found.")

    dfs = []
    for f in raw_files:
        df = pd.read_csv(f, header=None, names=col_names, low_memory=False)
        dfs.append(df)
    
    df = pd.concat(dfs, ignore_index=True)
    df = df.sort_values("Stime").reset_index(drop=True)

    df['start_ts'] = df['Stime'].astype(float)
    df['available_ts'] = df['Ltime'].astype(float)
    df['end_ts'] = df['Ltime'].astype(float)
    df['label'] = df['Label'].astype(int)

    if 'attack_cat' in df.columns:
        df['attack_cat'] = df['attack_cat'].astype(str).str.strip().replace('', np.nan)
        df['attack_cat'] = df['attack_cat'].replace('nan', np.nan)
    else:
        df['attack_cat'] = np.nan

    df['bytes'] = df['sbytes'].astype(float) + df['dbytes'].astype(float)
    df['packets'] = df['Spkts'].astype(float) + df['Dpkts'].astype(float)
    df['dur'] = df['dur'].astype(float)
    df['proto'] = df['proto'].astype(str).str.strip()
    df['state'] = df['state'].astype(str).str.strip()
    df['src_ip'] = df['srcip'].astype(str).str.strip()
    df['dst_ip'] = df['dstip'].astype(str).str.strip()

    df['src_port'] = pd.to_numeric(df['sport'], errors='coerce')
    df['dst_port'] = pd.to_numeric(df['dsport'], errors='coerce')

    starts = df["start_ts"].to_numpy(dtype=np.int64)
    ends = df["end_ts"].to_numpy(dtype=np.int64)
    occupied = np.unique(np.concatenate([starts // window_seconds, ends // window_seconds]))
    cuts = np.flatnonzero(np.diff(occupied) - 1 > max_gap_windows) + 1
    blocks = np.split(occupied, cuts)

    df['sequence_id'] = None
    for seq_idx, bins in enumerate(blocks):
        first, last = int(bins[0]), int(bins[-1])
        lo = first * window_seconds
        hi = (last + 1) * window_seconds
        mask = (starts >= lo) & (starts < hi)
        df.loc[mask, 'sequence_id'] = f"seq-{seq_idx:02d}"

    df = df.dropna(subset=['sequence_id'])

    cols = [
        'start_ts', 'available_ts', 'end_ts', 'label', 'attack_cat',
        'bytes', 'packets', 'dur', 'proto', 'state', 'src_ip', 'dst_ip',
        'src_port', 'dst_port', 'sequence_id'
    ]
    return df[cols].copy()
