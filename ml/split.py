import pandas as pd
import yaml

def chronological_split(df: pd.DataFrame, config_path: str = "configs/default.yaml") -> pd.DataFrame:
    df = df.sort_values('ts').reset_index(drop=True)
    n = len(df)
    train_end = int(n * 0.7)
    val_end = train_end + int(n * 0.1)
    
    df['split'] = 'test'
    df.loc[:train_end-1, 'split'] = 'train'
    df.loc[train_end:val_end-1, 'split'] = 'validation'
    
    return df
