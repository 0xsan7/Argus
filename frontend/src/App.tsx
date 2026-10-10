import React, { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'
import type { AnalystNote, DashboardData, Health, Meta, Metrics, TimelineWindow, WindowDetail } from './types'
import { chartSeries } from './timeline'

const modelNames = {
  rf: 'Random Forest',
  lr_current: 'Current-window LR',
  lr_lag: 'Lagged LR',
  oracle_persistence: 'Oracle persistence',
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null)
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
    setSelectedWindowId(id)
    setLoadingWindow(true)
    setWindowError(null)
    setWindowDetail(null)
    setNote(null)
    setLoadingNote(false)
    setNoteError(null)
    try {
      const res = await fetch(`/api/windows/${id}`)
      if (!res.ok) {
        if (res.status === 404) {
          setWindowError(`Window #${id} not found in test partition (evaluation timeline covers test split).`)
        } else {
          setWindowError(`Failed to fetch window #${id} (Status ${res.status}).`)
        }
        return
      }
      const json = await res.json()
      setWindowDetail(json)
    } catch {
      setWindowError('Could not load this window. Check that the Argus API is running, then try again.')
    } finally {
      setLoadingWindow(false)
    }
  }

  const generateNote = async (id: number) => {
    setLoadingNote(true)
    setNoteError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/windows/${id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        setNoteError(errJson?.error || `Request failed with status ${res.status}`)
        return
      }
      const json: AnalystNote = await res.json()
      setNote(json)
    } catch {
      setNoteError('Could not generate the analyst note. Check that the local service is available, then try again.')
    } finally {
      setLoadingNote(false)
    }
  }

  const rf = data?.metrics.models.find(model => model.name === 'rf')
  const fixture = data?.health.mode === 'fixtures'

  // Prepare chart series: for fixtures use all; for real large data use first sequence or slice
  const chartWindows = data ? (data.windows.length <= 100 ? data.windows : data.windows.slice(0, 100)) : []
  const series = data ? chartSeries(chartWindows, data.meta.window_seconds) : []
  const primarySeries = series[0] || { points: [], truth: [] }

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
          <a className="nav-item active" href="/" aria-current="page">
            <span className="nav-symbol">▦</span>Overview<span className="nav-dot" />
          </a>
          <button className="nav-item" disabled title="Available after Gate 0">
            <span className="nav-symbol">≋</span>Models<span className="soon">SOON</span>
          </button>
          <button className="nav-item" disabled title="Available after Gate 0">
            <span className="nav-symbol">ⓘ</span>About<span className="soon">SOON</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="local-indicator" /> LOCAL WORKSPACE
          <p>
            Offline by design.<br />
            Benchmark-data prototype.
          </p>
          <div className="sidebar-version">
            ARGUS / GATE 0<span>v0.1</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span><strong>Overview</strong>
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
                Test-period overview<span className="heading-dot" />
              </h1>
              <p>One-window-ahead risk scoring. Observable traffic in, next-window risk out.</p>
            </div>
            <span className="period-tag">TEST SPLIT</span>
          </div>

          {!data && !dashboardError ? (
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
                <Kpi
                  label="Flagged windows"
                  value={String(data.windows.filter(w => w.flagged).length)}
                  caption={`Risk ≥ ${data.meta.default_threshold.toFixed(2)} · default model`}
                  accent
                />
                <Kpi label="RF precision" value={rf ? percent(rf.precision) : '—'} caption="Correct alerts / all alerts" evaluation />
                <Kpi label="RF recall" value={rf ? percent(rf.recall) : '—'} caption="All malicious target windows" evaluation />
                <Kpi
                  label="RF onset recall"
                  value={rf ? percent(rf.onset_recall) : '—'}
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
                      Scores from {modelNames[data.meta.default_model]} · {data.meta.window_seconds}s prediction horizon
                      {data.windows.length > 100 && ` · Viewing first 100 of ${data.windows.length} test windows`}
                    </p>
                  </div>
                  <span className="model-tag">
                    <span className="local-indicator" />
                    {modelNames[data.meta.default_model]}
                    <span>DEFAULT</span>
                  </span>
                </div>

                <div className="chart-legend">
                  <span><i className="legend-line" />Risk score</span>
                  <span><i className="legend-point" />Flagged window</span>
                  <span><i className="legend-threshold" />Threshold {data.meta.default_threshold.toFixed(2)}</span>
                  <span className="evaluation-legend">
                    <i className="legend-truth" />Evaluation ground truth
                  </span>
                </div>

                <div className="chart-container">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={primarySeries.points} margin={{ top: 10, right: 20, bottom: 25, left: 0 }}>
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
                        y={data.meta.default_threshold}
                        stroke="var(--amber)"
                        strokeDasharray="3 3"
                      />
                      {primarySeries.truth.map((t, idx) => (
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
                </div>

                <div className="inspect-bar">
                  <span>Quick inspect:</span>
                  <button className="inspect-btn" onClick={() => inspectWindow(0)}>
                    Flagged Window #0
                  </button>
                  <button className="inspect-btn" onClick={() => inspectWindow(99999)}>
                    Train/Val Window #99999
                  </button>
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
                    <strong>Baseline context</strong>Current-window logistic regression is deployable. Oracle persistence uses current ground truth and is non-deployable. Comparison page follows Gate 0.
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
                    Stage: <span style={{ color: 'var(--truth)' }}>{windowDetail.evaluation_stage}</span> (dataset label, evaluation only)
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
                      <div className="meta-card-label">RISK SCORE (RF)</div>
                      <div className="meta-card-val" style={{ color: windowDetail.flagged ? 'var(--amber)' : 'var(--mint)' }}>
                        {windowDetail.risk.toFixed(3)} {windowDetail.flagged && '· FLAGGED'}
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
                    <div style={{ background: '#121a17', border: '1px solid var(--border)', borderRadius: 4, padding: '12px 14px' }}>
                      {windowDetail.top_features.map((feat, i) => (
                        <div key={i} className="shap-bar-row">
                          <span className="shap-bar-name">{feat.name}</span>
                          <span className="shap-bar-val">val: {feat.value}</span>
                          <span className={`shap-score ${feat.shap >= 0 ? 'shap-pos' : 'shap-neg'}`}>
                            {feat.shap >= 0 ? `+${feat.shap.toFixed(4)}` : feat.shap.toFixed(4)}
                          </span>
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
