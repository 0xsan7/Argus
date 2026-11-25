import { useEffect, useRef, useState, type FormEvent } from 'react'
import './investigation.css'

const prefix = '/api/investigation/v1'
const sampleName = 'zeek-conn-synthetic-v1.jsonl'
const dispositions = {
  expected: 'Expected', 'needs-investigation': 'Needs investigation', escalated: 'Escalated',
} as const
type Disposition = keyof typeof dispositions
type Job = {
  id: string; filename: string; sensor: string; status: 'queued' | 'processing' | 'completed' | 'failed'
  attempts: number; accepted: number; rejected: number; duplicates: number; error: string | null
}
type RecordSummary = {
  id: string; uid: string; start: string; end: string | null; protocol: string
  origin: string; responder: string; origin_port: number | null; responder_port: number | null
  orig_bytes: number | null; resp_bytes: number | null; orig_pkts: number | null; resp_pkts: number | null
}
type Source = { import_id: string; filename: string; line: number; received_at: string; digest: string; parser: string }
type Evidence = RecordSummary & { sensor: string; sources: Source[] }
type Bucket = { start: string; end: string; count: number | null; state: keyof typeof coverageLabels; verified: boolean }
type Timeline = { buckets: Bucket[]; records: RecordSummary[]; next: string | null; baseline: string; coverage: string[] | null; observed?: [string, string] }
type SavedCase = { id: string; title: string; disposition: Disposition; saved_at: string }
type CaseDetail = SavedCase & { reason: string; author: string; evidence: Evidence[] }
const coverageLabels = { observed: 'Observed records', 'verified-quiet': 'Verified quiet', unknown: 'Unknown coverage' }
const emptyFilter = { asset: '', start: '', stop: '' }
const pending = (job: Job) => job.status === 'queued' || job.status === 'processing'
const timestamp = (time: string) => time.replace('T', ' ').replace(/(\.\d*?[1-9])0+Z$|\.0+Z$/, '$1Z')
const timeOfDay = (time: string) => time.slice(11, 16)

function address(ip: string, port: number | null) {
  return port === null ? ip : `${ip.includes(':') ? `[${ip}]` : ip}:${port}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The workspace request failed.'
}

async function request(identity: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('X-Argus-Identity', identity)
  const response = await fetch(prefix + path, { ...init, headers })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(typeof result?.detail === 'string' ? result.detail :
      response.status === 404 ? 'Start the local investigation API and reload the workspace.' :
        'The workspace could not complete this request. Check the supplied values and try again.')
  }
  return response
}

export default function Investigation() {
  const [identity, setIdentity] = useState(() => sessionStorage.getItem('argus-test-identity') || 'alpha-analyst')
  useEffect(() => { document.title = 'Investigation workspace · Argus' }, [])
  return <>
    <header className="inv-header">
      <div className="inv-header-links"><strong>ARGUS</strong><a href="/">Benchmark Lab</a></div>
      <label>Local test identity
        <select value={identity} onChange={event => {
          sessionStorage.setItem('argus-test-identity', event.target.value)
          setIdentity(event.target.value)
        }}>
          <option value="alpha-analyst">Alpha · Analyst</option>
          <option value="alpha-viewer">Alpha · Viewer</option>
          <option value="beta-analyst">Beta · Analyst</option>
        </select>
      </label>
    </header>
    <Workspace key={identity} identity={identity} />
  </>
}

function Workspace({ identity }: { identity: string }) {
  const viewer = identity === 'alpha-viewer'
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobId, setJobId] = useState('')
  const [sensor, setSensor] = useState('edge')
  const [file, setFile] = useState<File | null>(null)
  const [synthetic, setSynthetic] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [serviceError, setServiceError] = useState('')
  const [actionError, setActionError] = useState('')
  const [filter, setFilter] = useState(emptyFilter)
  const [query, setQuery] = useState('')
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [timelineError, setTimelineError] = useState('')
  const [paging, setPaging] = useState(false)
  const [selected, setSelected] = useState('')
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [evidenceError, setEvidenceError] = useState('')
  const [attached, setAttached] = useState<Evidence[]>([])
  const [cases, setCases] = useState<SavedCase[]>([])
  const [caseId, setCaseId] = useState('')
  const [saved, setSaved] = useState<CaseDetail | null>(null)
  const [caseError, setCaseError] = useState('')
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [disposition, setDisposition] = useState<Disposition>('needs-investigation')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const selectedJob = jobs.find(job => job.id === jobId)
  const readyId = selectedJob?.status === 'completed' ? selectedJob.id : ''
  const active = jobs.some(pending)

  async function loadLists(signal?: AbortSignal) {
    try {
      const [imports, recent] = await Promise.all([
        request(identity, '/imports', { signal }).then(r => r.json() as Promise<Job[]>),
        request(identity, '/cases', { signal }).then(r => r.json() as Promise<SavedCase[]>),
      ])
      if (signal?.aborted) return
      setJobs(imports)
      setCases(recent)
      setJobId(current => imports.some(job => job.id === current) ? current : imports[0]?.id || '')
      setServiceError('')
    } catch (error) {
      if (!signal?.aborted) setServiceError(errorMessage(error))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadLists(controller.signal)
    return () => controller.abort()
  }, [identity])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: number
    async function poll() {
      await loadLists(controller.signal)
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 900)
    }
    timer = window.setTimeout(poll, 600)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [active, identity])

  useEffect(() => {
    if (!readyId) return
    const controller = new AbortController()
    request(identity, `/imports/${readyId}/timeline?${query}`, { signal: controller.signal })
      .then(r => r.json()).then(result => { if (!controller.signal.aborted) setTimeline(result) })
      .catch(error => { if (!controller.signal.aborted) setTimelineError(errorMessage(error)) })
    return () => controller.abort()
  }, [identity, readyId, query])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    request(identity, `/evidence/${selected}`, { signal: controller.signal })
      .then(r => r.json()).then(result => { if (!controller.signal.aborted) setEvidence(result) })
      .catch(error => { if (!controller.signal.aborted) setEvidenceError(errorMessage(error)) })
    return () => controller.abort()
  }, [identity, selected])

  useEffect(() => {
    if (evidence) detailHeading.current?.focus()
  }, [evidence])

  useEffect(() => {
    if (!caseId) return
    const controller = new AbortController()
    request(identity, `/cases/${caseId}`, { signal: controller.signal })
      .then(r => r.json()).then(result => { if (!controller.signal.aborted) setSaved(result) })
      .catch(error => { if (!controller.signal.aborted) setCaseError(errorMessage(error)) })
    return () => controller.abort()
  }, [identity, caseId])

  function selectJob(id: string) {
    if (id === jobId) return
    setJobId(id)
    setFilter(emptyFilter)
    setQuery('')
    setTimeline(null)
    setTimelineError('')
    setSelected('')
    setEvidence(null)
    setEvidenceError('')
  }

  async function useSample() {
    setActionError('')
    setBusy(true)
    try {
      const response = await request(identity, '/sample')
      const sample = new File([await response.blob()], sampleName, { type: 'text/plain' })
      const selection = new DataTransfer()
      selection.items.add(sample)
      if (fileInput.current) fileInput.current.files = selection.files
      setFile(sample)
      setSynthetic(true)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitImport(event: FormEvent) {
    event.preventDefault()
    if (!file || !synthetic || busy) return
    setActionError('')
    setBusy(true)
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('File exceeds the 50 MiB upload limit.')
      const response = await request(identity, `/imports?sensor=${sensor}`, {
        method: 'POST', body: file,
        headers: { 'Content-Type': 'text/plain', 'X-Argus-Synthetic': 'yes', 'X-Argus-Filename': encodeURIComponent(file.name) },
      })
      const job: Job = await response.json()
      setJobs(current => [job, ...current])
      selectJob(job.id)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function retry(id: string) {
    setActionError('')
    setBusy(true)
    try {
      const job: Job = await request(identity, `/imports/${id}/retry`, { method: 'POST' }).then(r => r.json())
      setJobs(current => current.map(item => item.id === job.id ? job : item))
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    const values = new URLSearchParams()
    if (filter.asset.trim()) values.set('asset', filter.asset.trim())
    if (filter.start) values.set('start', filter.start + 'Z')
    if (filter.stop) values.set('stop', filter.stop + 'Z')
    const next = values.toString()
    if (next === query) return
    setTimeline(null)
    setTimelineError('')
    setQuery(next)
  }

  async function nextPage() {
    if (!timeline?.next || paging) return
    const params = new URLSearchParams(query)
    params.set('after', timeline.next)
    const before = timeline
    setPaging(true)
    try {
      const page: Timeline = await request(identity, `/imports/${readyId}/timeline?${params}`).then(r => r.json())
      setTimeline(current => current === before ? { ...page, records: [...before.records, ...page.records] } : current)
    } catch (error) {
      setTimelineError(errorMessage(error))
    } finally {
      setPaging(false)
    }
  }

  function openEvidence(id: string) {
    if (id === selected) {
      detailHeading.current?.focus()
      return
    }
    setEvidence(null)
    setEvidenceError('')
    setSelected(id)
  }

  function openCase(id: string) {
    if (id === caseId) return
    setSaved(null)
    setCaseError('')
    setCaseId(id)
  }

  async function saveCase(event: FormEvent) {
    event.preventDefault()
    if (!attached.length || saving) return
    setSaving(true)
    setCaseError('')
    try {
      const result = await request(identity, '/cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, disposition, reason, evidence: attached.map(item => item.id) }),
      }).then(r => r.json() as Promise<{ id: string }>)
      setTitle('')
      setReason('')
      setAttached([])
      openCase(result.id)
      await loadLists()
    } catch (error) {
      setCaseError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function download(id: string) {
    setCaseError('')
    try {
      const response = await request(identity, `/cases/${id}/brief`)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `argus-case-${id}.md`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setCaseError(errorMessage(error))
    }
  }

  return <main className="inv-main">
    <div className="inv-heading">
      <h1>Investigation workspace</h1>
      <span className="period-tag">WORKSPACE {identity.startsWith('alpha') ? 'ALPHA' : 'BETA'} · UTC</span>
    </div>
    <div className="fixture-banner inv-notice">
      <p><strong>SYNTHETIC DATA ONLY</strong> · Local prototype. Use the included sample or simulated connections with documentation IP addresses. Evidence and cases persist in the local database.</p>
    </div>
    {serviceError && <div className="inv-error" role="alert">{serviceError} <button type="button" onClick={() => void loadLists()}>Refresh workspace</button></div>}

    <div className="inv-intake">
      {!viewer && <section className="timeline-panel inv-panel" aria-labelledby="inv-import-title">
        <div className="inv-section-header"><h2 id="inv-import-title">Import Zeek connections</h2>
          <button type="button" onClick={useSample} disabled={busy}>Use synthetic sample</button></div>
        <p className="inv-muted">One UTF-8 JSON-lines conn.log export per sensor. Up to 50 MiB, 250,000 nonblank rows and 64 KiB per row.</p>
        <form className="inv-form" onSubmit={submitImport}>
          <div className="inv-fields">
            <label>Sensor<select value={sensor} onChange={event => setSensor(event.target.value)}>
              <option value="edge">Edge sensor</option><option value="lab">Lab sensor</option>
            </select></label>
            <label>Zeek log file<input ref={fileInput} type="file" accept=".log,.jsonl,.txt,text/plain" onChange={event => {
              setFile(event.currentTarget.files?.[0] || null)
              setSynthetic(false)
            }} /></label>
          </div>
          <label className="inv-check"><input type="checkbox" checked={synthetic} onChange={event => setSynthetic(event.target.checked)} /> I confirm this export contains only synthetic data.</label>
          <button className="inv-primary" disabled={!file || !synthetic || loading || busy || Boolean(serviceError)}>{busy ? 'Working…' : 'Import log'}</button>
        </form>
      </section>}

      <section className="timeline-panel inv-panel" aria-labelledby="inv-jobs-title">
        <h2 id="inv-jobs-title">Recent imports</h2>
        {loading && <p className="inv-muted" role="status">Loading imports…</p>}
        {!loading && !jobs.length && !serviceError && <p className="inv-muted">Import a synthetic export to start a timeline.</p>}
        {jobs.length > 0 && <label className="inv-job-picker">Open import
          <select value={jobId} onChange={event => selectJob(event.target.value)}>
            {jobs.map(job => <option key={job.id} value={job.id}>{job.filename} · {job.sensor} · {job.status} · {job.id.slice(0, 8)}</option>)}
          </select>
        </label>}
        {selectedJob && <div className="inv-job-result" role="status">
          <p className="inv-job-state" data-state={selectedJob.status}>{selectedJob.status} {selectedJob.attempts > 1 && `· attempt ${selectedJob.attempts}`}</p>
          {pending(selectedJob) ? <p className="inv-muted">{selectedJob.status === 'queued' ? 'Waiting for the local worker.' : 'Validating rows and linking observations.'}</p> :
            <dl className="inv-counts">
              <div><dt>Accepted</dt><dd>{selectedJob.accepted}</dd></div>
              <div><dt>Rejected</dt><dd>{selectedJob.rejected}</dd></div>
              <div><dt>Duplicates</dt><dd>{selectedJob.duplicates}</dd></div>
            </dl>}
          {selectedJob.error && <p className="inv-muted">{selectedJob.error}</p>}
          {selectedJob.status === 'failed' && !viewer && selectedJob.attempts >= 3 &&
            <button type="button" disabled={busy} onClick={() => void retry(selectedJob.id)}>Retry import</button>}
        </div>}
      </section>
    </div>
    {actionError && <p className="inv-error" role="alert">{actionError}</p>}

    <div className="inv-desk">
      <section className="timeline-panel inv-panel" aria-labelledby="inv-timeline-title">
        <div className="inv-section-header"><h2 id="inv-timeline-title">Observation timeline</h2>
          {selectedJob && <span className="inv-muted">{selectedJob.sensor} sensor</span>}</div>
        {!readyId ? <p className="inv-empty">Open a completed import to explore its UTC timeline.</p> : <>
          <form className="inv-filter" onSubmit={applyFilters}>
            <label>Endpoint IP<input value={filter.asset} placeholder="Any endpoint" onChange={event => setFilter({ ...filter, asset: event.target.value })} /></label>
            <label>From (UTC)<input type="datetime-local" value={filter.start} onChange={event => setFilter({ ...filter, start: event.target.value })} /></label>
            <label>Before (UTC)<input type="datetime-local" value={filter.stop} onChange={event => setFilter({ ...filter, stop: event.target.value })} /></label>
            <button>Apply filters</button>
          </form>
          {timelineError && <p className="inv-error" role="alert">{timelineError}</p>}
          {!timeline && !timelineError && <p className="inv-empty" role="status">Loading timeline…</p>}
          {timeline && <>
            {timeline.observed && <p className="inv-range inv-muted">Imported observations from <span className="inv-data">{timestamp(timeline.observed[0])}</span> to <span className="inv-data">{timestamp(timeline.observed[1])}</span></p>}
            <p className="inv-baseline">{timeline.baseline}</p>
            <Coverage timeline={timeline} />
            {timeline.records.length ? <div className="inv-table-wrap"><table className="inv-observations-table">
              <thead><tr><th scope="col">Connection start (UTC)</th><th scope="col">Origin → responder</th><th scope="col">Protocol</th><th scope="col">Evidence</th></tr></thead>
              <tbody>{timeline.records.map(record => <tr key={record.id} className={selected === record.id ? 'inv-selected' : ''}>
                <td className="inv-data">{timestamp(record.start)}</td>
                <td className="inv-data">{address(record.origin, record.origin_port)} <span className="inv-muted">→</span> {address(record.responder, record.responder_port)}</td>
                <td>{record.protocol.toUpperCase()}</td>
                <td><button type="button" className="inv-text-button" onClick={() => openEvidence(record.id)}>Open {record.uid}</button></td>
              </tr>)}</tbody>
            </table></div> : <p className="inv-empty">No observations match these filters.</p>}
            {timeline.next && <button type="button" disabled={paging} onClick={() => void nextPage()}>{paging ? 'Loading…' : 'Load more observations'}</button>}
          </>}
        </>}
      </section>
      <section className="timeline-panel inv-panel" aria-labelledby="inv-detail-title">
        <h2 id="inv-detail-title" tabIndex={-1} ref={detailHeading}>Evidence detail</h2>
        {evidenceError && <p className="inv-error" role="alert">{evidenceError}</p>}
        {!evidence && !evidenceError && <p className="inv-empty">{selected ? 'Loading evidence…' : 'Open a connection to see its source record.'}</p>}
        {evidence && <>
          <h3>{evidence.uid} <span className="inv-muted">· {evidence.sensor} sensor</span></h3>
          <dl className="inv-evidence">
            <dt>Connection start</dt><dd>{timestamp(evidence.start)}</dd>
            <dt>Estimated end</dt><dd>{evidence.end ? timestamp(evidence.end) : 'Unknown'}</dd>
            <dt>Origin</dt><dd>{address(evidence.origin, evidence.origin_port)}{evidence.origin_port === null && ' · port unknown'}</dd>
            <dt>Responder</dt><dd>{address(evidence.responder, evidence.responder_port)}{evidence.responder_port === null && ' · port unknown'}</dd>
            <dt>Protocol</dt><dd>{evidence.protocol.toUpperCase()}</dd>
            <dt>Bytes (out / in)</dt><dd>{evidence.orig_bytes ?? 'Unknown'} / {evidence.resp_bytes ?? 'Unknown'}</dd>
            <dt>Packets (out / in)</dt><dd>{evidence.orig_pkts ?? 'Unknown'} / {evidence.resp_pkts ?? 'Unknown'}</dd>
          </dl>
          <h3>Source references</h3>
          <ul className="inv-sources">{evidence.sources.map(source => <li key={source.import_id}>
            <strong>{source.filename} · line {source.line}</strong>
            <span className="inv-muted">{source.parser} · received {timestamp(source.received_at)}</span>
            <details><summary>Import ID and SHA-256</summary><code>{source.import_id}<br />{source.digest}</code></details>
          </li>)}</ul>
          {!viewer && <button type="button" className="inv-primary" disabled={attached.length >= 20 || attached.some(item => item.id === evidence.id)}
            onClick={() => setAttached(current => [...current, evidence])}>{attached.some(item => item.id === evidence.id) ? 'Attached to case' : 'Attach to case'}</button>}
        </>}
      </section>
    </div>

    <section className="timeline-panel inv-panel inv-case" aria-labelledby="inv-case-title">
      <h2 id="inv-case-title">Cases</h2>
      <div className="inv-case-grid">
        {!viewer && <form className="inv-form" onSubmit={saveCase}>
          <h3>New case</h3>
          <label>Case title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>Disposition<select value={disposition} onChange={event => setDisposition(event.target.value as Disposition)}>
            {Object.entries(dispositions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>Reason<textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <p className="inv-muted" role="status">{attached.length ? `${attached.length} evidence attached` : 'Attach at least one evidence record to save.'}</p>
          {attached.length > 0 && <ul className="inv-attachments">{attached.map(item => <li key={item.id}>
            {item.uid} <button type="button" aria-label={`Remove ${item.uid}`} onClick={() => setAttached(current => current.filter(record => record.id !== item.id))}>Remove</button>
          </li>)}</ul>}
          <button className="inv-primary" disabled={!attached.length || saving}>{saving ? 'Saving…' : 'Save case'}</button>
        </form>}
        <div className="inv-saved">
          <h3>Saved cases</h3>
          {cases.length > 0 ? <label>Open saved case<select value={caseId} onChange={event => openCase(event.target.value)}>
            <option value="">Select a case</option>
            {cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select></label> : <p className="inv-muted">Saved investigations appear here.</p>}
          {caseId && !saved && !caseError && <p role="status" className="inv-muted">Loading case…</p>}
          {saved && <div className="inv-saved-detail" aria-live="polite">
            <h3>{saved.title}</h3><p><strong>{dispositions[saved.disposition]}</strong> · {saved.reason}</p>
            <p className="inv-muted">Saved by {saved.author} · {timestamp(saved.saved_at)}</p>
            <ul>{saved.evidence.map(item => <li key={item.id}><button type="button" className="inv-text-button" onClick={() => openEvidence(item.id)}>Open {item.uid}</button></li>)}</ul>
            {!viewer && <button type="button" onClick={() => void download(saved.id)}>Download Markdown brief</button>}
          </div>}
        </div>
      </div>
      {caseError && <p className="inv-error" role="alert">{caseError}</p>}
    </section>
  </main>
}

function Coverage({ timeline }: { timeline: Timeline }) {
  if (!timeline.buckets.length) return null
  const maxCount = Math.max(1, ...timeline.buckets.map(bucket => bucket.count ?? 0))
  return <div className="inv-coverage">
    <h3>Coverage</h3>
    {timeline.coverage ? <p className="inv-muted">Verified synthetic coverage from {timestamp(timeline.coverage[0])} to {timestamp(timeline.coverage[1])} (end excluded). Coverage outside that interval is unknown.</p> :
      <p className="inv-muted">This export has no verified collection interval. Empty periods have unknown coverage.</p>}
    <div className="inv-bars" aria-hidden="true">
      {timeline.buckets.map(bucket => <span key={bucket.start} data-state={bucket.state}
        title={`${timestamp(bucket.start)} · ${coverageLabels[bucket.state]}${bucket.count === null ? '' : ` · ${bucket.count}`}`}>
        {bucket.count !== null && <i style={{ height: `${Math.max(5, bucket.count / maxCount * 100)}%` }} />}
      </span>)}
    </div>
    <div className="inv-axis inv-data" aria-hidden="true"><span>{timeOfDay(timeline.buckets[0].start)}</span><span>{timeOfDay(timeline.buckets.at(-1)!.end)} UTC</span></div>
    <ul className="inv-legend">{Object.entries(coverageLabels).map(([state, label]) => <li key={state}><i data-state={state} />{label}</li>)}</ul>
    <details className="inv-intervals">
      <summary>View coverage intervals</summary>
      <div className="inv-table-wrap"><table>
        <thead><tr><th scope="col">From (UTC)</th><th scope="col">Before (UTC)</th><th scope="col">State</th><th scope="col">Records</th></tr></thead>
        <tbody>{timeline.buckets.map(bucket => <tr key={bucket.start}>
          <td className="inv-data">{timestamp(bucket.start)}</td><td className="inv-data">{timestamp(bucket.end)}</td>
          <td>{coverageLabels[bucket.state]}{bucket.state === 'observed' && !bucket.verified ? ' · coverage unverified' : ''}</td><td>{bucket.count ?? 'Unknown'}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
  </div>
}
