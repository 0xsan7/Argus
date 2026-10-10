import yaml
from ml.adapters.unsw_nb15 import load_unsw_nb15
from ml.features import build_features
from ml.split import chronological_split
import pandas as pd

def main():
    print("Running S1 (load_unsw_nb15)...")
    df = load_unsw_nb15("data/raw")
    print(f"S1 Rows: {len(df)}")
    
    print("Running S2 (build_features & split)...")
    feat_df = build_features(df)
    split_df = chronological_split(feat_df)
    
    print(f"S2 Windows: {len(split_df)}")
    print(f"Train windows: {len(split_df[split_df['split'] == 'train'])}")
    print(f"Val windows: {len(split_df[split_df['split'] == 'validation'])}")
    print(f"Test windows: {len(split_df[split_df['split'] == 'test'])}")

if __name__ == "__main__":
    main()
