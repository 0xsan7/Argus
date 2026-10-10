import { useEffect, useState } from 'react'
import type { DashboardData, Health, Meta, Metrics, TimelineWindow } from './types'

const modelNames = { rf: 'Random Forest', lr_current: 'Current-window LR', lr_lag: 'Lagged LR', oracle_persistence: 'Oracle persistence' }
const percent = (value: number) => `${(value * 100).toFixed(1)}%`

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const get = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { signal: controller.signal })
      return response.json()
    }
    Promise.all([
      get<Health>('/api/health'), get<Meta>('/api/meta'),
      get<TimelineWindow[]>('/api/timeline?split=test'), get<Metrics>('/api/metrics'),
    ]).then(([health, meta, windows, metrics]) => { if (!controller.signal.aborted) setData({ health, meta, windows, metrics }) })
    return () => controller.abort()
  }, [])
  const rf = data?.metrics.models.find(model => model.name === 'rf')
  const fixture = data?.health.mode === 'fixtures'
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Application navigation">
      <a className="brand" href="/" aria-label="Argus dashboard"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 5h5l6 17L20 5h5L14 27Z" /><path d="M11 5h6l-3 8Z" /></svg><span>ARGUS<span className="brand-sub">NETWORK OBSERVATORY</span></span></a>
      <div className="side-label">WORKSPACE</div>
      <nav aria-label="Main"><a className="nav-item active" href="/" aria-current="page"><span className="nav-symbol">▦</span>Overview<span className="nav-dot" /></a><button className="nav-item" disabled title="Available after Gate 0"><span className="nav-symbol">≋</span>Models<span className="soon">SOON</span></button><button className="nav-item" disabled title="Available after Gate 0"><span className="nav-symbol">ⓘ</span>About<span className="soon">SOON</span></button></nav>
      <div className="sidebar-bottom"><span className="local-indicator" /> LOCAL WORKSPACE<p>Offline by design.<br />Benchmark-data prototype.</p><div className="sidebar-version">ARGUS / GATE 0<span>v0.1</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>Overview</strong></div><div className="topbar-status"><span className="local-indicator" /> LOCAL RUNTIME<span className="divider" /><span className="mono">READ ONLY</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">NETWORK EARLY-WARNING CONSOLE</div><h1>Test-period overview<span className="heading-dot" /></h1><p>One-window-ahead risk scoring. Observable traffic in, next-window risk out.</p></div><span className="period-tag">TEST SPLIT</span></div>
        {!data ? <div className="state-panel" role="status"><span className="loading-mark" />Loading local evaluation…</div> : <>
          {fixture && <div className="fixture-banner" role="note"><span className="fixture-icon">!</span><div><strong>ILLUSTRATIVE UI FIXTURE — NOT BENCHMARK RESULTS</strong><p>No model trained. No benchmark evaluated. Scores, metrics and explanations are interface fixtures.</p></div><span className="fixture-badge">FIXTURE MODE</span></div>}
          <section className="kpi-grid" aria-label="Test-period indicators">
            <Kpi label="Test windows" value={String(data.metrics.test_windows)} caption="Chronological test partition" />
            <Kpi label="Flagged windows" value={String(data.windows.filter(w => w.flagged).length)} caption={`Risk ≥ ${data.meta.default_threshold.toFixed(2)} · default model`} accent />
            <Kpi label="RF precision" value={rf ? percent(rf.precision) : '—'} caption="Correct alerts / all alerts" evaluation />
            <Kpi label="RF recall" value={rf ? percent(rf.recall) : '—'} caption="All malicious target windows" evaluation />
            <Kpi label="RF onset recall" value={rf ? percent(rf.onset_recall) : '—'} caption={`${data.metrics.attack_onset_windows} attack-onset target windows`} evaluation />
          </section>
          <section className="timeline-panel" aria-labelledby="timeline-title"><div className="panel-heading"><div><div className="eyebrow">01 / RISK TIMELINE</div><h2 id="timeline-title">Next-window risk</h2><p>Scores from {modelNames[data.meta.default_model]} · {data.meta.window_seconds}s prediction horizon</p></div><span className="model-tag"><span className="local-indicator" />{modelNames[data.meta.default_model]}<span>DEFAULT</span></span></div><div className="chart-legend"><span><i className="legend-line" />Risk score</span><span><i className="legend-point" />Flagged window</span><span><i className="legend-threshold" />Threshold {data.meta.default_threshold.toFixed(2)}</span><span className="evaluation-legend"><i className="legend-truth" />Evaluation ground truth</span></div><div className="chart-placeholder">Preparing timeline…</div><div className="chart-footer"><span>MODEL OUTPUT<span className="footer-separator">/</span>Risk score, not calibrated probability</span><span>Window inspection available after Gate 0</span></div></section>
          <section className="context-grid" aria-label="Experiment context"><div className="context-block"><div className="eyebrow">02 / TEMPORAL CONTRACT</div><h3>Observe now. Score the next window.</h3><div className="time-contract"><span>INPUT<span>[start_ts, end_ts)</span></span><b aria-hidden="true">→</b><span className="target-contract">TARGET<span>[end_ts, end_ts + {data.meta.window_seconds}s)</span></span></div><p>Ground-truth shading belongs to the target interval. Labels are evaluation-only and are not available to the model.</p></div><div className="context-block"><div className="eyebrow">03 / EVALUATION GUARDRAILS</div><h3>Onset recall is not overall recall.</h3><p>Onset means a benign input window followed by a malicious target window. Continuation alone is not early warning.</p><div className="baseline-note"><strong>Baseline context</strong>Current-window logistic regression is deployable. Oracle persistence uses current ground truth and is non-deployable. Comparison page follows Gate 0.</div></div></section>
          <div className="run-strip"><span>RUN <strong>{data.meta.run_id}</strong></span><span>WINDOW <strong>{data.meta.window_seconds}s</strong></span><span>LOOKBACK <strong>{data.meta.lookback_windows} windows</strong></span><span>{fixture ? 'FIXTURE DATA · NOT LIVE TRAFFIC' : 'BENCHMARK DATA · NOT LIVE TRAFFIC'}</span></div>
        </>}
        <footer className="page-footer"><span>Argus <span className="footer-separator">/</span> A local early-warning experiment</span><span>MODEL OUTPUT ≠ EVALUATION TRUTH</span></footer>
      </main>
    </div>
  </div>
}

function Kpi({ label, value, caption, accent = false, evaluation = false }: { label: string; value: string; caption: string; accent?: boolean; evaluation?: boolean }) {
  return <article className={`kpi ${accent ? 'kpi-accent' : ''}`}><div className="kpi-label">{label}{evaluation && <span className="eval-marker" title="Evaluation-only metric">EVAL</span>}</div><strong className="kpi-value">{value}</strong><p>{caption}</p></article>
}
