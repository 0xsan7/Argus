import pickle
import numpy as np

with open("configs/models.pkl", "rb") as f:
    models = pickle.load(f)

with open("configs/s5_metrics.pkl", "rb") as f:
    s5 = pickle.load(f)

rf = models["rf"]
all_features = models["all_features"]
test_df = s5["test_df"]
X_all_raw = test_df[all_features].fillna(0)

import shap
explainer = shap.TreeExplainer(rf)
shap_vals = explainer.shap_values(X_all_raw.iloc[0:2])

print("all_features length:", len(all_features))
print("type of shap_vals:", type(shap_vals))
if isinstance(shap_vals, list):
    print("shap_vals is list of length:", len(shap_vals))
    print("shap_vals[1] shape:", shap_vals[1].shape)
else:
    print("shap_vals shape:", np.array(shap_vals).shape)
