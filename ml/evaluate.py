import yaml
import json
import pickle
import time
import warnings
warnings.filterwarnings("ignore")
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix, precision_recall_curve, auc

from ml.adapters.unsw_nb15 import load_unsw_nb15
from ml.features import build_features
from ml.split import chronological_split

def compute_metrics(y_true, y_probs, y_pred, truth_now, latencies=None):
    if len(y_true) == 0:
        return {}
    
    prec = float(precision_score(y_true, y_pred, zero_division=0))
    rec = float(recall_score(y_true, y_pred, zero_division=0))
    f1 = float(f1_score(y_true, y_pred, zero_division=0))
    
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    fpr = float(fp / (fp + tn)) if (fp + tn) > 0 else 0.0
    
    if y_probs is not None:
        p_curve, r_curve, _ = precision_recall_curve(y_true, y_probs)
        pr_auc = float(auc(r_curve, p_curve))
    else:
        pr_auc = None
        
    onset_mask = (truth_now == 0) & (y_true == 1)
    onset_true = y_true[onset_mask]
    onset_pred = y_pred[onset_mask]
    onset_rec = float(recall_score(onset_true, onset_pred, zero_division=0)) if len(onset_true) > 0 else 0.0
    
    med_lat = float(np.median(latencies)) if latencies is not None else 0.0
    
    return {
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "fpr": fpr,
        "pr_auc": pr_auc,
        "onset_recall": onset_rec,
        "latency_ms_per_window": med_lat,
        "confusion": {
            "tp": int(tp),
            "fp": int(fp),
            "tn": int(tn),
            "fn": int(fn)
        }
    }

def main():
    print("Loading data...")
    df_raw = load_unsw_nb15("data/raw")
    df_feat = build_features(df_raw)
    df_split = chronological_split(df_feat)
    
    test_df = df_split[df_split['split'] == 'test'].copy()
    
    y_true = test_df['truth_next'].values
    truth_now = test_df['truth_now'].values
    
    test_windows = len(test_df)
    positive_rate = float(np.mean(y_true == 1))
    attack_onset_windows = int(((truth_now == 0) & (y_true == 1)).sum())
    continuation_windows = int(((truth_now == 1) & (y_true == 1)).sum())
    
    print(f"Test windows: {test_windows}")
    print(f"Positive rate: {positive_rate:.4f}")
    print(f"Attack onset windows: {attack_onset_windows}")
    
    with open("configs/thresholds.yaml") as f:
        thresholds = yaml.safe_load(f)
        
    with open("configs/models.pkl", "rb") as f:
        models = pickle.load(f)
        
    scaler_curr = models["scaler_curr"]
    scaler_all = models["scaler_all"]
    lr_current = models["lr_current"]
    lr_lag = models["lr_lag"]
    rf = models["rf"]
    current_features = models["current_features"]
    all_features = models["all_features"]
    
    X_curr_raw = test_df[current_features].fillna(0)
    X_all_raw = test_df[all_features].fillna(0)
    
    X_curr = scaler_curr.transform(X_curr_raw)
    X_all = scaler_all.transform(X_all_raw)
    X_all_raw_np = X_all_raw.to_numpy()
    
    results = {}
    
    y_probs_oracle = None
    y_pred_oracle = truth_now
    results['oracle_persistence'] = compute_metrics(y_true, y_probs_oracle, y_pred_oracle, truth_now, latencies=[0.0])
    results['oracle_persistence']['name'] = 'oracle_persistence'
    results['oracle_persistence']['threshold'] = None
    
    sample_size = min(100, test_windows)
    
    lats = []
    for i in range(sample_size):
        t0 = time.perf_counter()
        lr_current.predict_proba(X_curr[i:i+1])
        lats.append((time.perf_counter() - t0) * 1000)
    y_probs_curr = lr_current.predict_proba(X_curr)[:, 1]
    y_pred_curr = (y_probs_curr >= thresholds['lr_current']).astype(int)
    results['lr_current'] = compute_metrics(y_true, y_probs_curr, y_pred_curr, truth_now, latencies=lats)
    results['lr_current']['name'] = 'lr_current'
    results['lr_current']['threshold'] = thresholds['lr_current']
    
    lats = []
    for i in range(sample_size):
        t0 = time.perf_counter()
        lr_lag.predict_proba(X_all[i:i+1])
        lats.append((time.perf_counter() - t0) * 1000)
    y_probs_lag = lr_lag.predict_proba(X_all)[:, 1]
    y_pred_lag = (y_probs_lag >= thresholds['lr_lag']).astype(int)
    results['lr_lag'] = compute_metrics(y_true, y_probs_lag, y_pred_lag, truth_now, latencies=lats)
    results['lr_lag']['name'] = 'lr_lag'
    results['lr_lag']['threshold'] = thresholds['lr_lag']
    
    lats = []
    for i in range(sample_size):
        t0 = time.perf_counter()
        rf.predict_proba(X_all_raw_np[i:i+1])
        lats.append((time.perf_counter() - t0) * 1000)
    y_probs_rf = rf.predict_proba(X_all_raw_np)[:, 1]
    y_pred_rf = (y_probs_rf >= thresholds['rf']).astype(int)
    results['rf'] = compute_metrics(y_true, y_probs_rf, y_pred_rf, truth_now, latencies=lats)
    results['rf']['name'] = 'rf'
    results['rf']['threshold'] = thresholds['rf']
    
    print(f"Oracle F1: {results['oracle_persistence']['f1']:.4f}")
    print(f"LR_Current F1: {results['lr_current']['f1']:.4f}")
    print(f"LR_Lag F1: {results['lr_lag']['f1']:.4f}")
    print(f"RF F1: {results['rf']['f1']:.4f}, Prec: {results['rf']['precision']:.4f}, Rec: {results['rf']['recall']:.4f}, Onset Rec: {results['rf']['onset_recall']:.4f}")
    
    with open("configs/s5_metrics.pkl", "wb") as f:
        pickle.dump({
            "test_windows": test_windows,
            "positive_rate": positive_rate,
            "attack_onset_windows": attack_onset_windows,
            "continuation_windows": continuation_windows,
            "metrics": results,
            "test_df": test_df,
            "y_probs_oracle": y_probs_oracle,
            "y_probs_curr": y_probs_curr,
            "y_probs_lag": y_probs_lag,
            "y_probs_rf": y_probs_rf
        }, f)

if __name__ == "__main__":
    main()
