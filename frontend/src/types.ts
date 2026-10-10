export type ModelName = 'oracle_persistence' | 'lr_current' | 'lr_lag' | 'rf'
export interface Health { ok: boolean; artifacts: boolean; ollama: boolean; mode: 'fixtures' | 'artifacts' }
export interface Meta {
  run_id: string; dataset: string; dataset_source: string; dataset_citation: string;
  window_seconds: number; lookback_windows: number; min_malicious_flows: number;
  default_model: ModelName; default_threshold: number; observation_policy: string;
  split: { train_end_ts: number; val_end_ts: number; test_start_ts: number }; generated_at: string;
}
export interface TimelineWindow {
  id: number; sequence_id: string; start_ts: number; end_ts: number; risk: number;
  flagged: boolean; truth_next: 0 | 1; evaluation_stage: string | null; explanation_available: boolean;
}
export interface ModelMetrics {
  name: ModelName; threshold: number | null; precision: number; recall: number; f1: number;
  fpr: number; pr_auc: number | null; onset_recall: number; latency_ms_per_window: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
}
export interface Metrics {
  run_id: string; test_windows: number; positive_rate: number; attack_onset_windows: number;
  continuation_windows: number; threshold_policy: string; models: ModelMetrics[]; notes: string[];
}
export interface DashboardData { health: Health; meta: Meta; windows: TimelineWindow[]; metrics: Metrics }
