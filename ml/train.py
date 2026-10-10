import yaml
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_recall_curve

from ml.adapters.unsw_nb15 import load_unsw_nb15
from ml.features import build_features
from ml.split import chronological_split

def maximize_f1_threshold(y_true, y_probs):
    precisions, recalls, thresholds = precision_recall_curve(y_true, y_probs)
    f1_scores = 2 * (precisions * recalls) / (precisions + recalls + 1e-9)
    best_idx = np.argmax(f1_scores)
    if best_idx < len(thresholds):
        return float(thresholds[best_idx])
    return 0.5

def main():
    print("Loading data...")
    df_raw = load_unsw_nb15("data/raw")
    df_feat = build_features(df_raw)
    df_split = chronological_split(df_feat)
    
    exclude_cols = ['label', 'attack_cat', 'truth_now', 'truth_next', 'sequence_id', 'split', 'window_id', 'ts']
    all_features = [c for c in df_split.columns if c not in exclude_cols]
    current_features = [c for c in all_features if 'lag' not in c and 'diff' not in c]
    
    train_df = df_split[df_split['split'] == 'train']
    val_df = df_split[df_split['split'] == 'validation']
    test_df = df_split[df_split['split'] == 'test']
    
    print(f"Train rows: {len(train_df)}")
    print(f"Val rows: {len(val_df)}")
    print(f"Test rows: {len(test_df)}")
    
    X_train_curr_raw = train_df[current_features].fillna(0)
    X_val_curr_raw = val_df[current_features].fillna(0)
    
    X_train_all_raw = train_df[all_features].fillna(0)
    X_val_all_raw = val_df[all_features].fillna(0)
    
    scaler_curr = StandardScaler().fit(X_train_curr_raw)
    X_train_curr = scaler_curr.transform(X_train_curr_raw)
    X_val_curr = scaler_curr.transform(X_val_curr_raw)
    
    scaler_all = StandardScaler().fit(X_train_all_raw)
    X_train_all = scaler_all.transform(X_train_all_raw)
    X_val_all = scaler_all.transform(X_val_all_raw)
    
    y_train = train_df['truth_next']
    y_val = val_df['truth_next']
    
    thresholds = {}
    
    print("Training lr_current...")
    lr_current = LogisticRegression(class_weight='balanced', max_iter=1000, random_state=42)
    lr_current.fit(X_train_curr, y_train)
    val_probs_curr = lr_current.predict_proba(X_val_curr)[:, 1]
    thresholds['lr_current'] = maximize_f1_threshold(y_val, val_probs_curr)
    
    print("Training lr_lag...")
    lr_lag = LogisticRegression(class_weight='balanced', max_iter=1000, random_state=42)
    lr_lag.fit(X_train_all, y_train)
    val_probs_lag = lr_lag.predict_proba(X_val_all)[:, 1]
    thresholds['lr_lag'] = maximize_f1_threshold(y_val, val_probs_lag)
    
    Path("configs").mkdir(exist_ok=True)
    with open("configs/thresholds.yaml", "w") as f:
        yaml.dump(thresholds, f)
        
    for k, v in thresholds.items():
        print(f"Threshold {k}: {v:.4f}")

if __name__ == "__main__":
    main()
