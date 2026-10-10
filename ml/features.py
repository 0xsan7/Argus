import pandas as pd
import numpy as np
import yaml

def entropy(x):
    counts = x.value_counts()
    if len(counts) == 0: return 0.0
    probs = counts / len(x)
    return float(-np.sum(probs * np.log2(probs + 1e-9)))

def build_features(df: pd.DataFrame, config_path: str = "configs/default.yaml") -> pd.DataFrame:
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    window_seconds = config.get("window_seconds", 1)
    lookback = config.get("lookback_windows", 5)
    min_mal_flows = config.get("min_malicious_flows", 1)
    
    seq_frames = []
    
    for seq_id, seq_df in df.groupby('sequence_id'):
        starts = seq_df['start_ts'].values
        avail = seq_df['available_ts'].values
        
        first_start = np.min(starts)
        last_start = np.max(starts)
        last_avail = np.max(avail)
        
        min_win = int(first_start // window_seconds)
        max_win = int(max(last_start, last_avail) // window_seconds)
        
        num_windows = max_win - min_win + 1
        windows = np.arange(min_win, max_win + 1)
        win_ts = windows * window_seconds
        
        feat_win = (avail // window_seconds) - min_win
        truth_win = (starts // window_seconds) - min_win
        
        labels = seq_df['label'].values
        
        mal_counts = np.bincount(truth_win[labels == 1].astype(int), minlength=num_windows)
        truth_now = (mal_counts >= min_mal_flows).astype(int)
        
        truth_next = np.zeros(num_windows, dtype=float)
        truth_next[:-1] = truth_now[1:]
        truth_next[-1] = np.nan
        
        seq_df_feat = seq_df.copy()
        seq_df_feat['win_idx'] = feat_win.astype(int)
        
        grouped = seq_df_feat.groupby('win_idx')
        
        win_df = pd.DataFrame({'window_id': windows, 'ts': win_ts})
        win_df['truth_now'] = truth_now
        win_df['truth_next'] = truth_next
        win_df['sequence_id'] = seq_id
        
        agg = grouped.agg(
            flow_count=('start_ts', 'count'),
            total_bytes=('bytes', 'sum'),
            total_packets=('packets', 'sum'),
            unique_src_ip=('src_ip', 'nunique'),
            unique_dst_ip=('dst_ip', 'nunique'),
            unique_dst_port=('dst_port', 'nunique'),
            dur_mean=('dur', 'mean'),
            dur_std=('dur', 'std'),
            dur_max=('dur', 'max'),
            bytes_mean=('bytes', 'mean'),
            bytes_std=('bytes', 'std'),
            bytes_max=('bytes', 'max')
        )
        
        # Safely compute tcp/udp counts if column exists
        if 'proto' in seq_df.columns:
            tcp_count = grouped.apply(lambda x: (x['proto'] == 'tcp').sum(), include_groups=False)
            udp_count = grouped.apply(lambda x: (x['proto'] == 'udp').sum(), include_groups=False)
        else:
            tcp_count = pd.Series(0, index=agg.index)
            udp_count = pd.Series(0, index=agg.index)
            
        agg['frac_tcp'] = tcp_count / agg['flow_count'].replace(0, 1)
        agg['frac_udp'] = udp_count / agg['flow_count'].replace(0, 1)
        
        if 'state' in seq_df.columns:
            failure_count = grouped.apply(lambda x: x['state'].isin(['RST', 'REJ']).sum(), include_groups=False)
        else:
            failure_count = pd.Series(0, index=agg.index)
            
        agg['frac_failure'] = failure_count / agg['flow_count'].replace(0, 1)
        agg['port_diversity'] = agg['unique_dst_port'] / agg['flow_count'].replace(0, 1)
        
        ent = grouped['dst_port'].apply(entropy, include_groups=False)
        agg['dst_port_entropy'] = ent
        
        win_df = win_df.join(agg)
        
        feat_cols = agg.columns.tolist()
        win_df[feat_cols] = win_df[feat_cols].fillna(0)
        
        for col in feat_cols:
            for l in range(1, lookback):
                win_df[f'{col}_lag{l}'] = win_df[col].shift(l)
        
        win_df['flow_count_diff'] = win_df['flow_count'].diff()
        win_df['total_bytes_diff'] = win_df['total_bytes'].diff()
        
        win_df = win_df.dropna().reset_index(drop=True)
        win_df['truth_next'] = win_df['truth_next'].astype(int)
        
        seq_frames.append(win_df)
        
    final_df = pd.concat(seq_frames, ignore_index=True) if seq_frames else pd.DataFrame()
    return final_df
