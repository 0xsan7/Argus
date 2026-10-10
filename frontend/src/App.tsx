import React, { useEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  BarChart,
  Bar,
  CartesianGrid,
} from 'recharts'
import type { AnalystNote, DashboardData, Health, Meta, Metrics, ModelMetrics, ModelName, TimelineWindow, WindowDetail } from './types'
import { chartSeries, selectModelTimeline, timelinePlotPoints } from './timeline'

const modelNames = {
  rf: 'Random Forest',
  lr_current: 'Current-window LR',
  lr_lag: 'Lagged LR',
  oracle_persistence: 'Oracle persistence',
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const modelOrder: ModelName[] = ['oracle_persistence', 'lr_current', 'lr_lag', 'rf']
const dashboardModelLabels: Record<ModelName, string> = {
  rf: 'Random Forest',
  lr_current: 'Current-window LR',
  lr_lag: 'Lagged LR',
  oracle_persistence: 'Persistence (non-deployable, diagnostic only)',
}

function metricText(value: number | null, metric: 'pr_auc' | 'f1' | 'recall' | 'onset_recall' | 'fpr' | 'latency_ms_per_window') {
  if (value === null || value === undefined) return 'N/A'
  if (metric === 'latency_ms_per_window') return `${value.toFixed(2)} ms`
  if (metric === 'f1' || metric === 'recall' || metric === 'onset_recall' || metric === 'fpr') return percent(value)
  return value.toFixed(3)
}

function comparisonSentence(models: ModelMetrics[]) {
  const rf = models.find(model => model.name === 'rf')
  const lr = models.find(model => model.name === 'lr_current')
  if (!rf || !lr) return 'RF and current-window LR metrics are not both available for comparison. Oracle persistence is non-deployable because it uses current-window ground truth.'
  const compare = (label: string, rfValue: number | null, lrValue: number | null, metric: 'pr_auc' | 'f1') => {
    if (rfValue === null || lrValue === null) return `${label} is unavailable for one or both models`
    const result = rfValue > lrValue ? 'beats' : rfValue < lrValue ? 'trails' : 'matches'
    return `${result} current-window LR on ${label} (${metricText(rfValue, metric)} vs ${metricText(lrValue, metric)})`
  }
  return `RF ${compare('PR-AUC', rf.pr_auc, lr.pr_auc, 'pr_auc')} and ${compare('F1', rf.f1, lr.f1, 'f1')}. Oracle persistence is non-deployable because it uses current-window ground truth.`
}

type ComparisonMetric = 'pr_auc' | 'f1' | 'recall' | 'onset_recall' | 'fpr' | 'latency_ms_per_window'
const comparisonMetrics: { key: ComparisonMetric; label: string }[] = [
  { key: 'pr_auc', label: 'PR-AUC' },
  { key: 'f1', label: 'F1' },
  { key: 'recall', label: 'Recall' },
  { key: 'onset_recall', label: 'Onset recall' },
  { key: 'fpr', label: 'FPR' },
  { key: 'latency_ms_per_window', label: 'Latency (ms/window)' },
]

function ModelsPage({ metrics, loading, error, onRetry }: { metrics: Metrics | null; loading: boolean; error: string | null; onRetry: () => void }) {
  const [selectedMetric, setSelectedMetric] = useState<ComparisonMetric>('f1')
  if (loading) return <div className="state-panel" role="status"><span className="loading-mark" />Loading model metrics…</div>
  if (error) return <div className="state-panel" role="alert"><strong>Model metrics unavailable</strong><p>{error}</p><button className="inspect-btn" onClick={onRetry}>Retry loading metrics</button></div>
  if (!metrics?.models.length) return <div className="state-panel" role="status"><strong>No model metrics available</strong><p>The metrics artifact contains no evaluated models.</p></div>

  const rows = modelOrder.map(name => metrics.models.find(model => model.name === name) ?? null)
  const chartData = rows.map((model, index) => ({
    name: modelNames[modelOrder[index]],
    value: model?.[selectedMetric] ?? null,
  }))
  const selectedLabel = comparisonMetrics.find(metric => metric.key === selectedMetric)?.label ?? 'F1'

  return (
    <div className="models-page">
      <section className="comparison-summary" aria-label="Model comparison summary">
        <div className="eyebrow">TEST SPLIT / FOUR MODEL EVALUATION</div>
        <p>{comparisonSentence(metrics.models)}</p>
      </section>
      <section className="models-panel" aria-labelledby="models-table-title">
        <div className="models-panel-heading"><div><div className="eyebrow">01 / METRICS</div><h2 id="models-table-title">Test performance</h2></div><span className="eval-marker">EVALUATION ONLY</span></div>
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead><tr><th scope="col">Model</th><th scope="col">PR-AUC</th><th scope="col">F1</th><th scope="col">Recall</th><th scope="col">Onset recall</th><th scope="col">FPR</th><th scope="col">Latency</th></tr></thead>
            <tbody>{rows.map((model, index) => <tr key={modelOrder[index]}>
              <th scope="row">{modelNames[modelOrder[index]]}{modelOrder[index] === 'oracle_persistence' && <span className="model-caveat">Non-deployable diagnostic</span>}</th>
              <td>{metricText(model?.pr_auc ?? null, 'pr_auc')}</td><td>{metricText(model?.f1 ?? null, 'f1')}</td><td>{metricText(model?.recall ?? null, 'recall')}</td><td>{metricText(model?.onset_recall ?? null, 'onset_recall')}</td><td>{metricText(model?.fpr ?? null, 'fpr')}</td><td>{metricText(model?.latency_ms_per_window ?? null, 'latency_ms_per_window')}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="threshold-note">Threshold policy: {metrics.threshold_policy || 'not recorded'}. Oracle persistence is a diagnostic that uses current-window ground truth.</p>
      </section>
      <section className="models-panel" aria-labelledby="models-chart-title">
        <div className="models-panel-heading"><div><div className="eyebrow">02 / MODEL COMPARISON</div><h2 id="models-chart-title">Compare {selectedLabel}</h2></div>
          <label className="chart-metric-select">Metric<select aria-label="Chart metric" value={selectedMetric} onChange={event => setSelectedMetric(event.target.value as ComparisonMetric)}>{comparisonMetrics.map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label>
        </div>
        <div className="comparison-chart" role="img" aria-label={`${selectedLabel} model comparison chart`}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 8, right: 18, bottom: 8, left: 5 }}>
              <CartesianGrid stroke="#2c3932" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" stroke="#5c6b63" tick={{ fill: '#c1cec8', fontSize: 11 }} />
              <YAxis stroke="#5c6b63" tick={{ fill: '#99aba0', fontSize: 10 }} />
              <Tooltip formatter={value => metricText(Number(value ?? 0), selectedMetric)} contentStyle={{ background: '#17211d', border: '1px solid #2c3932' }} />
              <Bar dataKey="value" name={selectedLabel} fill="var(--mint)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

function AboutPage({ meta, loading, error, onRetry, fixture }: { meta: Meta | null; loading: boolean; error: string | null; onRetry: () => void; fixture: boolean }) {
  if (loading) return <div className="state-panel" role="status"><span className="loading-mark" />Loading experiment details…</div>
  if (error || !meta) return <div className="state-panel" role="alert"><strong>Experiment details unavailable</strong><p>{error ?? 'The local evaluation metadata is unavailable.'}</p><button className="inspect-btn" onClick={onRetry}>Retry loading About</button></div>

  return (
    <div className="about-page">
      {fixture && <div className="fixture-banner" role="note"><strong>Fixture mode is illustrative; it contains no UNSW-NB15 benchmark results.</strong></div>}
      <section className="about-grid" aria-label="About Argus">
        <article className="about-card"><div className="eyebrow">01 / PURPOSE</div><h2>Problem</h2><p>Security teams need time to inspect network alerts. Argus explores whether aggregated flow telemetry can identify elevated risk in the next short time window.</p></article>
        <article className="about-card"><div className="eyebrow">02 / APPROACH</div><h2>Method</h2><p>Argus aggregates network flows into {meta.window_seconds}-second windows and scores whether the following window contains malicious activity. It reports a risk score, not a calibrated probability.</p><p>Full-flow features become usable at the documented observation boundary: {meta.observation_policy}</p></article>
        <article className="about-card"><div className="eyebrow">03 / SOURCE</div><h2>Dataset citation</h2><p className="dataset-citation">Moustafa, Nour, and Jill Slay. “UNSW-NB15: a comprehensive data set for network intrusion detection systems (UNSW-NB15 network data set).” 2015 Military Communications and Information Systems Conference (MilCIS). IEEE, 2015.</p><p>Dataset: UNSW-NB15. Benchmark captures are not live production traffic.</p></article>
        <article className="about-card"><div className="eyebrow">04 / EVALUATION</div><h2>Chronological split</h2><p>Eligible target windows are ordered by time and divided into 70% training, 10% validation, and 20% test partitions. Thresholds are selected on validation data; reported test metrics use the held-out final period.</p><p>Window duration in the loaded metadata: {meta.window_seconds} seconds. Fixture mode uses illustrative metadata.</p></article>
        <article className="about-card"><div className="eyebrow">05 / LIMITS</div><h2>Limitations</h2><ul><li>The UNSW-NB15 test partition is attack-dense: 88.6% positive, compared with about 33% in training.</li><li>This is one public benchmark capture; results do not establish performance on other networks or unseen attack families.</li><li>Early warning refers to the next window only. Overall recall and attack-onset recall describe different outcomes.</li><li>Public dataset labels can be uncertain. Stage or ATT&amp;CK context is a retrospective lookup from evaluation labels, never a model prediction.</li><li>Oracle persistence uses current-window ground truth and is non-deployable. Gemma only drafts analyst notes from operational outputs and does not affect risk scores.</li></ul></article>
        <article className="about-card"><div className="eyebrow">06 / CLAIMS</div><h2>Claims policy</h2><p>Describe Argus as a one-window-ahead network risk-scoring experiment evaluated chronologically on benchmark data. Say “risk score,” not “probability.” State onset recall separately when discussing early warning.</p><p>Argus is a local benchmark-data prototype, not a production intrusion detection system. Do not claim live detection, long-horizon forecasting, unseen-attack generalization, or predicted ATT&amp;CK tactics.</p></article>
      </section>
    </div>
  )
}

export default function App() {
  const routePage = () => window.location.pathname === '/models' ? 'models' : window.location.pathname === '/about' ? 'about' : 'dashboard'
  const [page, setPage] = useState<'dashboard' | 'models' | 'about'>(routePage)
  const [data, setData] = useState<DashboardData | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelName>('rf')
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [dashboardAttempt, setDashboardAttempt] = useState(0)
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null)
  const [windowDetail, setWindowDetail] = useState<WindowDetail | null>(null)
  const [windowError, setWindowError] = useState<string | null>(null)
  const [loadingWindow, setLoadingWindow] = useState(false)
  const [inspectInputId, setInspectInputId] = useState('')
  const [note, setNote] = useState<AnalystNote | null>(null)
  const [loadingNote, setLoadingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const detailRequestId = useRef(0)
  const noteRequestId = useRef(0)

  useEffect(() => {
    const onPopState = () => setPage(routePage())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (path: '/' | '/models' | '/about') => {
    window.history.pushState({}, '', path)
    setPage(path === '/models' ? 'models' : path === '/about' ? 'about' : 'dashboard')
  }

  useEffect(() => {
    const controller = new AbortController()
    const get = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { signal: controller.signal })
      if (!response.ok) throw new Error(`The local service returned status ${response.status}.`)
      return response.json()
    }
    setData(null)
    setDashboardError(null)
    Promise.all([
      get<Health>('/api/health'),
      get<Meta>('/api/meta'),
      get<TimelineWindow[]>('/api/timeline?split=test'),
      get<Metrics>('/api/metrics'),
    ]).then(([health, meta, windows, metrics]) => {
      if (!controller.signal.aborted) setData({ health, meta, windows, metrics })
    }).catch(() => {
      if (!controller.signal.aborted) setDashboardError('Could not load the local evaluation. Check that the Argus API is running, then try again.')
    })
    return () => controller.abort()
  }, [dashboardAttempt])

  const retryDashboard = () => setDashboardAttempt(attempt => attempt + 1)

  const inspectWindow = async (id: number) => {
    const requestId = ++detailRequestId.current
    noteRequestId.current += 1
    setSelectedWindowId(id)
    setLoadingWindow(true)
    setWindowError(null)
    setWindowDetail(null)
    setNote(null)
    setLoadingNote(false)
    setNoteError(null)
    try {
      const res = await fetch(`/api/windows/${id}`)
      if (requestId !== detailRequestId.current) return
      if (!res.ok) {
        if (res.status === 404) {
          setWindowError(`Window #${id} not found in test partition (evaluation timeline covers test split).`)
        } else {
          setWindowError(`Failed to fetch window #${id} (Status ${res.status}).`)
        }
        return
      }
      const json = await res.json()
      if (requestId === detailRequestId.current) setWindowDetail(json)
    } catch {
      if (requestId === detailRequestId.current) setWindowError('Could not load this window. Check that the Argus API is running, then try again.')
    } finally {
      if (requestId === detailRequestId.current) setLoadingWindow(false)
    }
  }

  const generateNote = async (id: number) => {
    const requestId = ++noteRequestId.current
    setLoadingNote(true)
    setNoteError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/windows/${id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (requestId !== noteRequestId.current) return
      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        if (requestId === noteRequestId.current) setNoteError(errJson?.error || `Request failed with status ${res.status}`)
        return
      }
      const json: AnalystNote = await res.json()
      if (requestId === noteRequestId.current) setNote(json)
    } catch {
      if (requestId === noteRequestId.current) setNoteError('Could not generate the analyst note. Check that the local service is available, then try again.')
    } finally {
      if (requestId === noteRequestId.current) setLoadingNote(false)
    }
  }

  const selectedModelMetrics = data?.metrics.models.find(model => model.name === selectedModel)
  const selectedThreshold = selectedModel === 'oracle_persistence'
    ? 0.5
    : selectedModelMetrics?.threshold ?? (data?.meta.default_model === selectedModel ? data.meta.default_threshold : undefined)
  const selectedTimeline = data && selectedThreshold !== undefined
    ? selectModelTimeline(data.windows, selectedModel, selectedThreshold, data.meta.default_model)
    : { available: false, windows: [] as TimelineWindow[] }
  const fixture = data?.health.mode === 'fixtures'

  const chartWindows = selectedTimeline.windows
  const series = data ? chartSeries(chartWindows, data.meta.window_seconds) : []
  const chartPoints = timelinePlotPoints(series, data?.meta.window_seconds ?? 0)
  const truthIntervals = series.flatMap(segment => segment.truth)
  const topFlaggedWindows = chartWindows.filter(window => window.flagged).sort((a, b) => b.risk - a.risk).slice(0, 5)
  const selectedDetailRisk = windowDetail?.risk_by_model?.[selectedModel] ?? (selectedModel === data?.meta.default_model ? windowDetail?.risk : undefined)
  const selectedDetailFlagged = selectedDetailRisk !== undefined && selectedThreshold !== undefined && selectedDetailRisk >= selectedThreshold
  const shapFeatures = [...(windowDetail?.top_features ?? [])].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap))
  const maxShapMagnitude = Math.max(...shapFeatures.map(feature => Math.abs(feature.shap)), 0)

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Application navigation">
        <a className="brand" href="/" aria-label="Argus dashboard">
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <path d="M3 5h5l6 17L20 5h5L14 27Z" />
            <path d="M11 5h6l-3 8Z" />
          </svg>
          <span>
            ARGUS<span className="brand-sub">NETWORK OBSERVATORY</span>
          </span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav aria-label="Main">
          <a className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} href="/" aria-current={page === 'dashboard' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('/') }}>
            <span className="nav-symbol">▦</span>Overview<span className="nav-dot" />
          </a>
          <a className={`nav-item ${page === 'models' ? 'active' : ''}`} href="/models" aria-current={page === 'models' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('/models') }}>
            <span className="nav-symbol">≋</span>Models
          </a>
          <a className={`nav-item ${page === 'about' ? 'active' : ''}`} href="/about" aria-current={page === 'about' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('/about') }}>
            <span className="nav-symbol">ⓘ</span>About
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="local-indicator" /> LOCAL WORKSPACE
          <p>
            Offline by design.<br />
            Benchmark-data prototype.
          </p>
          <div className="sidebar-version">
            ARGUS / LOCAL CONSOLE<span>v0.1</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span><strong>{page === 'models' ? 'Models' : page === 'about' ? 'About' : 'Overview'}</strong>
          </div>
          <div className="topbar-status">
            <span className="local-indicator" /> LOCAL RUNTIME<span className="divider" />
            <span className="mono">READ ONLY</span>
          </div>
        </header>

        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">NETWORK EARLY-WARNING CONSOLE</div>
              <h1>
                {page === 'models' ? 'Model comparison' : page === 'about' ? 'About Argus' : 'Test-period overview'}<span className="heading-dot" />
              </h1>
              <p>{page === 'models' ? 'Compare test-period risk scoring against the persistence diagnostic and deployable baselines.' : page === 'about' ? 'Experiment method, benchmark source, limitations, and claims policy.' : 'One-window-ahead risk scoring. Observable traffic in, next-window risk out.'}</p>
            </div>
            <span className="period-tag">{page === 'about' ? 'METHOD & CLAIMS' : 'TEST SPLIT'}</span>
          </div>

          {page === 'models' ? (
            <ModelsPage metrics={data?.metrics ?? null} loading={!data && !dashboardError} error={dashboardError} onRetry={retryDashboard} />
          ) : page === 'about' ? (
            <AboutPage meta={data?.meta ?? null} loading={!data && !dashboardError} error={dashboardError} onRetry={retryDashboard} fixture={fixture ?? false} />
          ) : !data && !dashboardError ? (
            <div className="state-panel" role="status">
              <span className="loading-mark" />Loading local evaluation…
            </div>
          ) : dashboardError ? (
            <div className="state-panel" role="alert">
              <strong>Evaluation unavailable</strong>
              <p>{dashboardError}</p>
              <button className="inspect-btn" onClick={retryDashboard}>Retry loading dashboard</button>
            </div>
          ) : (
            <>
              {fixture && (
                <div className="fixture-banner" role="note">
                  <span className="fixture-icon">!</span>
                  <div>
                    <strong>ILLUSTRATIVE UI FIXTURE — NOT BENCHMARK RESULTS</strong>
                    <p>
                      No model trained. No benchmark evaluated. Scores, metrics and explanations are interface fixtures.
                    </p>
                  </div>
                  <span className="fixture-badge">FIXTURE MODE</span>
                </div>
              )}

              {data && <section className="kpi-grid" aria-label="Test-period indicators">
                <Kpi label="Test windows" value={String(data.metrics.test_windows)} caption="Chronological test partition" />
                <Kpi label="Flagged windows" value={selectedTimeline.available ? String(chartWindows.filter(w => w.flagged).length) : '—'} caption={selectedThreshold === undefined ? 'Threshold unavailable' : `${selectedModel === 'oracle_persistence' ? 'Diagnostic boundary' : 'Risk'} ≥ ${selectedThreshold.toFixed(2)}`} accent />
                <Kpi label={`${selectedModel === 'oracle_persistence' ? 'Persistence' : modelNames[selectedModel]} precision`} value={selectedModelMetrics ? percent(selectedModelMetrics.precision) : '—'} caption="Correct alerts / all alerts" evaluation />
                <Kpi label={`${selectedModel === 'oracle_persistence' ? 'Persistence' : modelNames[selectedModel]} recall`} value={selectedModelMetrics ? percent(selectedModelMetrics.recall) : '—'} caption="All malicious target windows" evaluation />
                <Kpi
                  label={`${selectedModel === 'oracle_persistence' ? 'Persistence' : modelNames[selectedModel]} onset recall`}
                  value={selectedModelMetrics ? percent(selectedModelMetrics.onset_recall) : '—'}
                  caption={`${data.metrics.attack_onset_windows} attack-onset target windows`}
                  evaluation
                />
              </section>}

              {data && data.windows.length === 0 ? (
                <div className="state-panel" role="status">
                  <strong>No test-period windows available</strong>
                  <p>The API returned no windows for the test split. Check the selected artifacts or fixture data.</p>
                </div>
              ) : data && <section className="timeline-panel" aria-labelledby="timeline-title">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">01 / RISK TIMELINE</div>
                    <h2 id="timeline-title">Next-window risk</h2>
                    <p>
                      Scores from {dashboardModelLabels[selectedModel]} · {data.meta.window_seconds}s prediction horizon · All {data.windows.length} test windows
                    </p>
                  </div>
                  <label className="model-tag model-select-label">Model
                    <select aria-label="Dashboard model" value={selectedModel} onChange={event => setSelectedModel(event.target.value as ModelName)}>
                      {modelOrder.slice().reverse().map(model => <option key={model} value={model}>{dashboardModelLabels[model]}{data.meta.default_model === model ? ' · default' : ''}</option>)}
                    </select>
                  </label>
                </div>

                <div className="chart-legend">
                  <span><i className="legend-line" />Risk score</span>
                  <span><i className="legend-point" />Flagged window</span>
                  <span><i className="legend-threshold" />{selectedModel === 'oracle_persistence' ? 'Diagnostic boundary' : 'Threshold'} {selectedThreshold?.toFixed(2) ?? 'unavailable'}</span>
                  <span className="evaluation-legend">
                    <i className="legend-truth" />Evaluation ground truth
                  </span>
                </div>

                {!selectedTimeline.available ? (
                  <div className="state-panel model-series-empty" role="status">
                    <strong>{selectedThreshold === undefined ? 'Model threshold unavailable' : `${modelNames[selectedModel]} scores unavailable`}</strong>
                    <p>The timeline response does not include per-window scores for this model. Choose the default model or update the local API response to include risk_by_model.</p>
                  </div>
                ) : <div className="chart-container">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartPoints} margin={{ top: 10, right: 20, bottom: 25, left: 0 }}>
                      <XAxis
                        dataKey="targetStart"
                        stroke="#5c6b63"
                        tick={{ fill: '#99aba0', fontSize: 10 }}
                        label={{ value: 'Target interval start · seconds', position: 'insideBottom', offset: -15, fill: '#99aba0', fontSize: 10 }}
                      />
                      <YAxis
                        domain={[0, 1]}
                        stroke="#5c6b63"
                        tick={{ fill: '#99aba0', fontSize: 10 }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null
                          const pt = payload[0].payload
                          if (pt.gap || pt.risk === null) return null
                          return (
                            <div style={{ background: '#17211d', border: '1px solid #2c3932', padding: '8px 12px', borderRadius: 4, fontSize: 11 }}>
                              <div style={{ color: '#9cdfb7', fontWeight: 600 }}>Window #{pt.id}</div>
                              <div>Risk: {pt.risk?.toFixed(3)}</div>
                              <div>Flagged: {pt.flagged ? 'Yes' : 'No'}</div>
                              <div>Target start: {pt.targetStart}s</div>
                            </div>
                          )
                        }}
                      />
                      <ReferenceLine
                        y={selectedThreshold ?? data.meta.default_threshold}
                        stroke="var(--amber)"
                        strokeDasharray="3 3"
                      />
                      {truthIntervals.map((t, idx) => (
                        <ReferenceArea
                          key={idx}
                          x1={t.start}
                          x2={t.end}
                          y1={0}
                          y2={1}
                          fill="#615b77"
                          fillOpacity={0.25}
                          stroke="#a59ab5"
                        />
                      ))}
                      <Line
                        type="monotone"
                        dataKey="risk"
                        connectNulls={false}
                        stroke="var(--mint)"
                        strokeWidth={2}
                        isAnimationActive={false}
                        dot={(props: { cx?: number; cy?: number; payload?: { id: number; flagged?: boolean } }) => {
                          if (!props.payload?.flagged || props.cx === undefined || props.cy === undefined) return null
                          const id = props.payload.id
                          return (
                            <circle
                              key={`dot-${id}`}
                              cx={props.cx}
                              cy={props.cy}
                              r={4}
                              fill="var(--amber)"
                              className="flagged-point"
                              style={{ cursor: 'pointer' }}
                              onClick={() => inspectWindow(id)}
                            />
                          )
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>}

                <div className="inspect-bar">
                  <span>Quick inspect:</span>
                  {topFlaggedWindows.length ? topFlaggedWindows.map(window => (
                    <button className="inspect-btn" key={window.id} onClick={() => inspectWindow(window.id)}>
                      #{window.id} · {window.risk.toFixed(3)}
                    </button>
                  )) : <span>No flagged test windows</span>}
                  <span style={{ marginLeft: 'auto' }}>Or inspect by ID:</span>
                  <input
                    type="number"
                    className="inspect-input"
                    placeholder="Window ID"
                    value={inspectInputId}
                    onChange={e => setInspectInputId(e.target.value)}
                  />
                  <button
                    className="inspect-btn"
                    disabled={!inspectInputId}
                    onClick={() => inspectWindow(Number(inspectInputId))}
                  >
                    Open
                  </button>
                </div>

                <div className="chart-footer">
                  <span>
                    MODEL OUTPUT<span className="footer-separator">/</span>Risk score, not calibrated probability
                  </span>
                  <span>Click flagged points or use Quick Inspect below</span>
                </div>
              </section>}

              {data && data.windows.length > 0 && <section className="context-grid" aria-label="Experiment context">
                <div className="context-block">
                  <div className="eyebrow">02 / TEMPORAL CONTRACT</div>
                  <h3>Observe now. Score the next window.</h3>
                  <div className="time-contract">
                    <span>INPUT<span>[start_ts, end_ts)</span></span>
                    <b aria-hidden="true">→</b>
                    <span className="target-contract">TARGET<span>[end_ts, end_ts + {data.meta.window_seconds}s)</span></span>
                  </div>
                  <p>Ground-truth shading belongs to the target interval. Labels are evaluation-only and are not available to the model.</p>
                </div>
                <div className="context-block">
                  <div className="eyebrow">03 / EVALUATION GUARDRAILS</div>
                  <h3>Onset recall is not overall recall.</h3>
                  <p>Onset means a benign input window followed by a malicious target window. Continuation alone is not early warning.</p>
                  <div className="baseline-note">
                    <strong>Baseline context</strong>Current-window logistic regression is deployable. Oracle persistence uses current ground truth and is non-deployable. Compare model metrics on the Models page.
                  </div>
                </div>
              </section>}

              {data && data.windows.length > 0 && <div className="run-strip">
                <span>RUN <strong>{data.meta.run_id}</strong></span>
                <span>WINDOW <strong>{data.meta.window_seconds}s</strong></span>
                <span>LOOKBACK <strong>{data.meta.lookback_windows} windows</strong></span>
                <span>{fixture ? 'FIXTURE DATA · NOT LIVE TRAFFIC' : 'BENCHMARK DATA · NOT LIVE TRAFFIC'}</span>
              </div>}
            </>
          )}

          <footer className="page-footer">
            <span>Argus <span className="footer-separator">/</span> A local early-warning experiment</span>
            <span>MODEL OUTPUT ≠ EVALUATION TRUTH</span>
          </footer>
        </main>
      </div>

      {/* Window Detail Modal */}
      {selectedWindowId !== null && (
        <div className="window-modal-backdrop" onClick={() => setSelectedWindowId(null)}>
          <div className="window-modal" onClick={e => e.stopPropagation()}>
            <div className="window-modal-header">
              <div>
                <div className="window-modal-title">
                  Window #{selectedWindowId} Inspection
                </div>
                {windowDetail?.evaluation_stage && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Stage: <span className="stage-tooltip" tabIndex={0} title="Dataset label, evaluation only. Not a model prediction." aria-label={`Stage ${windowDetail.evaluation_stage}. Dataset label, evaluation only. Not a model prediction.`} style={{ color: 'var(--truth)' }}>{windowDetail.evaluation_stage}</span> <span className="stage-context">(dataset label, evaluation only)</span>
                  </div>
                )}
              </div>
              <button className="close-btn" onClick={() => setSelectedWindowId(null)}>✕ Close</button>
            </div>

            {loadingWindow ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--muted)' }}>
                Loading window #{selectedWindowId} details…
              </div>
            ) : windowError ? (
              <div style={{ padding: '20px', background: '#241a1a', border: '1px solid #5a3030', borderRadius: 6, color: '#f5a6a6' }}>
                <strong style={{ display: 'block', marginBottom: 6 }}>Notice</strong>
                {windowError}
                <button className="inspect-btn" style={{ display: 'block', marginTop: 12 }} onClick={() => inspectWindow(selectedWindowId)}>
                  Retry loading window
                </button>
              </div>
            ) : windowDetail ? (
              <div>
                <div className="window-section">
                  <div className="window-section-title">METRICS & RISK</div>
                  <div className="grid-3">
                    <div className="meta-card">
                      <div className="meta-card-label">RISK SCORE ({modelNames[selectedModel]})</div>
                      <div className="meta-card-val" style={{ color: selectedDetailFlagged ? 'var(--amber)' : 'var(--mint)' }}>
                        {selectedDetailRisk === undefined ? 'Unavailable for selected model' : `${selectedDetailRisk.toFixed(3)} ${selectedDetailFlagged ? '· FLAGGED' : ''}`}
                      </div>
                    </div>
                    <div className="meta-card">
                      <div className="meta-card-label">SPLIT</div>
                      <div className="meta-card-val">{windowDetail.split.toUpperCase()}</div>
                    </div>
                    <div className="meta-card">
                      <div className="meta-card-label">SEQUENCE ID</div>
                      <div className="meta-card-val">{windowDetail.sequence_id}</div>
                    </div>
                  </div>
                </div>

                <div className="window-section">
                  <div className="window-section-title">TOP SHAP EXPLANATION (RANDOM FOREST)</div>
                  {!windowDetail.explanation_available || !windowDetail.top_features || windowDetail.top_features.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 11, fontStyle: 'italic', padding: '10px 0' }}>
                      SHAP explanation unavailable for this window.
                    </div>
                  ) : (
                    <div className="shap-chart" role="region" aria-label="SHAP contribution chart">
                      <div className="shap-chart-axis"><span>← lowers risk</span><span>0</span><span>raises risk →</span></div>
                      {shapFeatures.map(feat => (
                        <div key={feat.name} className="shap-bar-row" data-feature={feat.name} role="group">
                          <span className="shap-bar-name" title={feat.name}>{feat.name}</span>
                          <span className={`shap-track ${feat.shap < 0 ? 'negative' : 'positive'}`} role="meter" aria-label={`${feat.name} SHAP contribution`} aria-valuemin={-maxShapMagnitude} aria-valuemax={maxShapMagnitude} aria-valuenow={feat.shap}>
                            <i className={`shap-bar-fill ${feat.shap < 0 ? 'negative' : 'positive'}`} style={{ width: `${maxShapMagnitude ? (Math.abs(feat.shap) / maxShapMagnitude) * 50 : 0}%` }} />
                          </span>
                          <span className={`shap-score ${feat.shap >= 0 ? 'shap-pos' : 'shap-neg'}`}>
                            {feat.shap >= 0 ? `+${feat.shap.toFixed(4)}` : feat.shap.toFixed(4)}
                          </span>
                          <span className="shap-bar-val" title="Feature value">val: {feat.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="window-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div className="window-section-title" style={{ margin: 0 }}>ANALYST NOTE</div>
                    {!loadingNote && (
                      <button
                        className="note-generate-btn"
                        onClick={() => generateNote(windowDetail.id)}
                        style={{
                          background: 'var(--amber)',
                          color: '#000',
                          border: 'none',
                          padding: '6px 14px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {note ? 'Regenerate analyst note' : 'Generate analyst note'}
                      </button>
                    )}
                  </div>

                  {loadingNote && (
                    <div className="note-loading" style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', background: '#111a16', borderRadius: 4, border: '1px solid var(--border)' }}>
                      Generating analyst note…
                    </div>
                  )}

                  {noteError && (
                    <div className="note-error" style={{ padding: '14px', background: '#241a1a', border: '1px solid #5a3030', borderRadius: 4, color: '#f5a6a6', fontSize: 12 }}>
                      <strong style={{ display: 'block', marginBottom: 4 }}>Error generating note</strong>
                      <div>{noteError}</div>
                      <button
                        onClick={() => generateNote(windowDetail.id)}
                        style={{
                          marginTop: 10,
                          background: 'transparent',
                          border: '1px solid #5a3030',
                          color: '#f5a6a6',
                          padding: '4px 10px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 11
                        }}
                      >
                        Try again
                      </button>
                    </div>
                  )}

                  {note && (
                    <div className="note-panel" style={{ background: '#121a17', border: '1px solid var(--border)', borderRadius: 4, padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span
                          className="note-source-badge"
                          style={{
                            padding: '3px 9px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            fontFamily: 'var(--mono)',
                            background: note.source === 'gemma' ? '#183626' : '#2b2316',
                            color: note.source === 'gemma' ? 'var(--mint)' : 'var(--amber)',
                            border: `1px solid ${note.source === 'gemma' ? '#275239' : '#4f3b20'}`
                          }}
                        >
                          {note.source === 'gemma' ? 'Gemma' : 'Template fallback'}
                        </span>
                        {note.model && (
                          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                            {note.model}
                          </span>
                        )}
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                          Threat Summary
                        </div>
                        <div style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.5 }}>
                          {note.threat_summary}
                        </div>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                          Why Suspicious
                        </div>
                        <div style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.5 }}>
                          {note.why_suspicious}
                        </div>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                          Suggested Checks
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#e6edf3', lineHeight: 1.5 }}>
                          {note.suggested_checks?.map((check, idx) => (
                            <li key={idx} style={{ marginBottom: 4 }}>{check}</li>
                          ))}
                        </ul>
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
                        {note.caveat}
                      </div>
                    </div>
                  )}
                </div>

                <div className="window-section">
                  <div className="window-section-title">TRAFFIC COUNTS (OBSERVABLE IN CUTOFF)</div>
                  <div className="grid-3">
                    <div className="meta-card">
                      <div className="meta-card-label">FLOWS</div>
                      <div className="meta-card-val">{windowDetail.counts?.flows ?? '—'}</div>
                    </div>
                    <div className="meta-card">
                      <div className="meta-card-label">BYTES</div>
                      <div className="meta-card-val">{windowDetail.counts?.bytes?.toLocaleString() ?? '—'}</div>
                    </div>
                    <div className="meta-card">
                      <div className="meta-card-label">PACKETS</div>
                      <div className="meta-card-val">{windowDetail.counts?.packets?.toLocaleString() ?? '—'}</div>
                    </div>
                  </div>
                </div>

                <div className="window-section">
                  <div className="window-section-title" style={{ color: 'var(--truth)' }}>
                    GROUND TRUTH (EVALUATION ONLY)
                  </div>
                  <div className="grid-2">
                    <div className="meta-card" style={{ borderColor: '#483d5a' }}>
                      <div className="meta-card-label">CURRENT WINDOW TRUTH</div>
                      <div className="meta-card-val" style={{ color: windowDetail.truth_now ? 'var(--amber)' : 'var(--mint)' }}>
                        {windowDetail.truth_now ? 'MALICIOUS (1)' : 'BENIGN (0)'}
                      </div>
                    </div>
                    <div className="meta-card" style={{ borderColor: '#483d5a' }}>
                      <div className="meta-card-label">NEXT WINDOW TRUTH (TARGET)</div>
                      <div className="meta-card-val" style={{ color: windowDetail.truth_next ? 'var(--amber)' : 'var(--mint)' }}>
                        {windowDetail.truth_next ? 'MALICIOUS (1)' : 'BENIGN (0)'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  caption,
  accent = false,
  evaluation = false,
}: {
  label: string
  value: string
  caption: string
  accent?: boolean
  evaluation?: boolean
}) {
  return (
    <article className={`kpi ${accent ? 'kpi-accent' : ''}`}>
      <div className="kpi-label">
        {label}
        {evaluation && (
          <span className="eval-marker" title="Evaluation-only metric">
            EVAL
          </span>
        )}
      </div>
      <strong className="kpi-value">{value}</strong>
      <p>{caption}</p>
    </article>
  )
}
