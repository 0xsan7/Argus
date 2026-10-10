import json
import pickle
import os
import datetime
from pathlib import Path
import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

def main():
    with open("configs/models.pkl", "rb") as f:
        models = pickle.load(f)
    
    with open("configs/s5_metrics.pkl", "rb") as f:
        s5 = pickle.load(f)
        
    with open("configs/default.yaml") as f:
        import yaml
        config = yaml.safe_load(f)
        
    rf = models["rf"]
    all_features = models["all_features"]
    
    test_df = s5["test_df"]
    y_probs_oracle = s5["y_probs_oracle"]
    y_probs_curr = s5["y_probs_curr"]
    y_probs_lag = s5["y_probs_lag"]
    y_probs_rf = s5["y_probs_rf"]
    
    thresholds = {}
    with open("configs/thresholds.yaml") as f:
        thresholds = yaml.safe_load(f)
        
    rf_thresh = thresholds['rf']
    
    try:
        import shap
        explainer = shap.TreeExplainer(rf)
        shap_success = True
        shap_reason = "Success"
    except Exception as e:
        shap_success = False
        shap_reason = str(e)
        
    windows_output = []
    
    flagged_indices = np.where(y_probs_rf >= rf_thresh)[0]
    unflagged_indices = np.where(y_probs_rf < rf_thresh)[0]
    
    explain_indices = set(flagged_indices[:200])
    if len(unflagged_indices) > 0:
        explain_indices.add(unflagged_indices[0])
        
    explained_count = 0
    X_all_raw = test_df[all_features].fillna(0)
    explain_list = list(explain_indices)
    shap_values_dict = {}
    
    if shap_success and len(explain_list) > 0:
        try:
            X_explain = X_all_raw.iloc[explain_list]
            shap_vals = explainer.shap_values(X_explain)
            if isinstance(shap_vals, list):
                shap_vals_class1 = shap_vals[:, :, 1] if len(np.array(shap_vals).shape) == 3 else shap_vals[1]
            else:
                if hasattr(shap_vals, 'values'):
                    if len(shap_vals.values.shape) == 3:
                        shap_vals_class1 = shap_vals[:, :, 1] if len(np.array(shap_vals).shape) == 3 else shap_vals.values[:, :, 1]
                    else:
                        shap_vals_class1 = shap_vals[:, :, 1] if len(np.array(shap_vals).shape) == 3 else shap_vals.values
                else:
                    shap_vals_class1 = shap_vals[:, :, 1] if len(np.array(shap_vals).shape) == 3 else shap_vals
                    
            for idx, real_idx in enumerate(explain_list):
                shap_values_dict[real_idx] = shap_vals_class1[idx]
        except Exception as e:
            shap_success = False
            shap_reason = str(e)

    for i in range(len(test_df)):
        row = test_df.iloc[i]
        
        counts = {
            "flow_count": int(row.get("flow_count", 0)),
            "bytes": int(row.get("total_bytes", 0)),
            "packets": int(row.get("total_packets", 0))
        }
        
        explanation_available = False
        top_features_list = []
        
        if shap_success and i in shap_values_dict:
            sv = shap_values_dict[i]
            sv = np.array(sv).flatten()
            abs_sv = np.abs(sv)
            top_5_idx = np.argsort(abs_sv)[-5:][::-1]
            
            for f_idx in top_5_idx:
                fname = all_features[int(f_idx)]
                fval = X_all_raw.iloc[i][fname]
                sval = float(sv[int(f_idx)])
                top_features_list.append({
                    "feature": fname,
                    "value": float(fval),
                    "shap": sval
                })
            explanation_available = True
            explained_count += 1
            
        risk_rf = float(y_probs_rf[i])
        
        w_obj = {
            "id": f"test-{i}",
            "sequence_id": str(row["sequence_id"]),
            "start_ts": float(row["ts"]),
            "end_ts": float(row["ts"] + config.get("window_seconds", 1)),
            "split": "test",
            "risk": risk_rf,
            "risk_by_model": {
                "oracle_persistence": float(y_probs_oracle[i]) if y_probs_oracle is not None else float(row["truth_now"]),
                "lr_current": float(y_probs_curr[i]),
                "lr_lag": float(y_probs_lag[i]),
                "rf": risk_rf
            },
            "flagged": bool(risk_rf >= rf_thresh),
            "truth_now": int(row["truth_now"]),
            "truth_next": int(row["truth_next"]),
            "evaluation_attack_category": str(row["attack_cat"]) if pd.notna(row.get("attack_cat")) else None,
            "evaluation_stage": None,
            "explanation_available": explanation_available,
            "top_features": top_features_list,
            "counts": counts
        }
        windows_output.append(w_obj)
        
    Path("artifacts").mkdir(exist_ok=True)
    
    with open("artifacts/timeline.json", "w") as f:
        json.dump(windows_output, f, indent=2)
        
    metrics_obj = {
        "run_id": "argus-run-1",
        "test_windows": int(s5["test_windows"]),
        "positive_rate": float(s5["positive_rate"]),
        "attack_onset_windows": int(s5["attack_onset_windows"]),
        "continuation_windows": int(s5["continuation_windows"]),
        "threshold_policy": "validation F1 per predictive model",
        "models": [],
        "notes": [
            f"RF threshold is {rf_thresh}; test set is {s5['positive_rate']*100:.1f}% attack"
        ]
    }
    
    for m_name in ["oracle_persistence", "lr_current", "lr_lag", "rf"]:
        m_data = s5["metrics"][m_name]
        metrics_obj["models"].append(m_data)
        
    with open("artifacts/metrics.json", "w") as f:
        json.dump(metrics_obj, f, indent=2)
        
    source_files = []
    for sf in Path("data/raw").glob("UNSW-NB15_*.csv"):
        source_files.append({
            "filename": sf.name,
            "size_bytes": sf.stat().st_size
        })
        
    manifest_obj = {
        "run_id": "argus-run-1",
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "dataset": "UNSW-NB15",
        "source_files": source_files,
        "config": {
            "window_seconds": config.get("window_seconds", 1),
            "lookback_windows": config.get("lookback_windows", 5),
            "min_malicious_flows": config.get("min_malicious_flows", 1),
            "max_gap_windows": config.get("max_gap_windows", 60),
            "random_seed": config.get("random_seed", 42)
        },
        "models": {
            "lr_current": {},
            "lr_lag": {},
            "rf": {}
        },
        "feature_names": all_features
    }
    
    with open("artifacts/run_manifest.json", "w") as f:
        json.dump(manifest_obj, f, indent=2)
        
    print(f"Explained count: {explained_count}")
    print(f"SHAP success: {shap_success} ({shap_reason})")
    print(f"timeline.json size: {Path('artifacts/timeline.json').stat().st_size} bytes")
    print(f"metrics.json size: {Path('artifacts/metrics.json').stat().st_size} bytes")
    print(f"run_manifest.json size: {Path('artifacts/run_manifest.json').stat().st_size} bytes")

if __name__ == "__main__":
    main()
