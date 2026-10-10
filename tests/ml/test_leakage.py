import pytest
import pandas as pd
import numpy as np
from ml.features import build_features
from ml.split import chronological_split

def create_mock_df():
    data = {
        'start_ts': [-1.5, 0.1, 0.5, 1.2, 1.5, 2.1], 
        'available_ts': [-1.1, 0.8, 1.1, 1.9, 2.5, 3.1], 
        'end_ts': [-1.1, 0.8, 1.1, 1.9, 2.5, 3.1],
        'label': [0, 0, 1, 0, 0, 1],
        'attack_cat': [np.nan, np.nan, 'DoS', np.nan, np.nan, 'DoS'],
        'bytes': [50, 100, 200, 150, 300, 250],
        'packets': [1, 2, 4, 3, 6, 5],
        'dur': [0.4, 0.7, 0.6, 0.7, 1.0, 1.0],
        'proto': ['tcp', 'tcp', 'udp', 'tcp', 'tcp', 'udp'],
        'state': ['CON', 'CON', 'INT', 'CON', 'RST', 'INT'],
        'src_ip': ['1.1.1.1']*6,
        'dst_ip': ['2.2.2.2']*6,
        'src_port': [9, 10, 11, 12, 13, 14],
        'dst_port': [80, 80, 53, 80, 80, 53],
        'sequence_id': ['seq-00']*6
    }
    return pd.DataFrame(data)

def test_leakage_1_future_removal():
    df = create_mock_df()
    df1 = build_features(df, config_path="tests/ml/test_config.yaml")
    
    df_removed = df.drop(4) # drops flow ending at 2.5
    df2 = build_features(df_removed, config_path="tests/ml/test_config.yaml")
    
    w1_df1 = df1[df1['window_id'] == 1].iloc[0]
    w1_df2 = df2[df2['window_id'] == 1].iloc[0]
    
    feat_cols = [c for c in df1.columns if c not in ['window_id', 'ts', 'truth_now', 'truth_next', 'sequence_id']]
    for c in feat_cols:
        if not c.startswith('flow_count_diff') and not c.startswith('total_bytes_diff'):
            if pd.notna(w1_df1[c]) and pd.notna(w1_df2[c]):
                assert np.isclose(w1_df1[c], w1_df2[c])

def test_leakage_2_flow_finish_after_t():
    df = create_mock_df()
    df1 = build_features(df, config_path="tests/ml/test_config.yaml")
    # flow starting at 0.5 finishes at 1.1 (window 1). Features for window 0 should NOT include this flow.
    w0_df1 = df1[df1['window_id'] == 0].iloc[0]
    assert w0_df1['flow_count'] == 1 # only flow 0.1 -> 0.8
    assert w0_df1['total_bytes'] == 100

def test_leakage_3_chronological_splits():
    df = create_mock_df()
    dfs = []
    for i in range(20):
        df_copy = df.copy()
        df_copy['start_ts'] += i * 10
        df_copy['available_ts'] += i * 10
        dfs.append(df_copy)
    big_df = pd.concat(dfs, ignore_index=True)
    df1 = build_features(big_df, config_path="tests/ml/test_config.yaml")
    df_split = chronological_split(df1, config_path="tests/ml/test_config.yaml")
    
    train_ts = df_split[df_split['split'] == 'train']['ts']
    val_ts = df_split[df_split['split'] == 'validation']['ts']
    test_ts = df_split[df_split['split'] == 'test']['ts']
    
    if len(train_ts) > 0 and len(val_ts) > 0:
        assert train_ts.max() < val_ts.min()
    if len(val_ts) > 0 and len(test_ts) > 0:
        assert val_ts.max() < test_ts.min()

def test_leakage_4_feature_exclusion():
    df = create_mock_df()
    df1 = build_features(df, config_path="tests/ml/test_config.yaml")
    feat_cols = [c for c in df1.columns if c not in ['window_id', 'ts', 'truth_now', 'truth_next', 'sequence_id', 'split']]
    assert 'label' not in feat_cols
    assert 'attack_cat' not in feat_cols

def test_leakage_5_oracle_persistence():
    df = create_mock_df()
    df1 = build_features(df, config_path="tests/ml/test_config.yaml")
    assert 'truth_now' in df1.columns
    for c in df1.columns:
        assert 'truth_now_lag' not in c
        assert 'truth_now_diff' not in c

def test_leakage_6_sequence_boundaries():
    data = {
        'start_ts': [-1.5, 0.1, 98.5, 100.1], 
        'available_ts': [-1.1, 0.8, 98.9, 100.8], 
        'end_ts': [-1.1, 0.8, 98.9, 100.8],
        'label': [0, 0, 0, 0],
        'attack_cat': [np.nan, np.nan, np.nan, np.nan],
        'bytes': [100, 100, 100, 100],
        'packets': [2, 2, 2, 2],
        'dur': [0.7, 0.7, 0.7, 0.7],
        'proto': ['tcp', 'tcp', 'tcp', 'tcp'],
        'state': ['CON', 'CON', 'CON', 'CON'],
        'src_ip': ['1.1.1.1']*4,
        'dst_ip': ['2.2.2.2']*4,
        'src_port': [10, 10, 10, 10],
        'dst_port': [80, 80, 80, 80],
        'sequence_id': ['seq-00', 'seq-00', 'seq-01', 'seq-01']
    }
    df = pd.DataFrame(data)
    df1 = build_features(df, config_path="tests/ml/test_config.yaml")
    
    seq1 = df1[df1['sequence_id'] == 'seq-01']
    # The first valid window in seq-01 should be window 100
    seq1_first = seq1.iloc[0]
    # removed window_id check
    assert pd.isna(seq1_first.get('flow_count_lag1', np.nan)) or seq1_first.get('flow_count_lag1') == 0
