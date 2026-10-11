import { useEffect, useRef, useState } from 'react'
import type { AnalystNote } from './types'

function completeReport(value: unknown, windowId: number): value is AnalystNote {
  if (!value || typeof value !== 'object') return false
  const note = value as Partial<AnalystNote>
  return note.window_id === windowId
    && (note.source === 'template' || (note.source === 'gemma' && typeof note.model === 'string' && !!note.model.trim()))
    && [note.threat_summary, note.why_suspicious, note.caveat].every(field => typeof field === 'string' && !!field.trim())
    && Array.isArray(note.suggested_checks) && note.suggested_checks.length > 0
    && note.suggested_checks.every(check => typeof check === 'string' && !!check.trim())
}

// Own request state here so generating text does not rerender the full risk chart.
export default function AnalystReport({ windowId, buttonLabel = 'Generate analyst note' }: { windowId: number; buttonLabel?: string }) {
  const [note, setNote] = useState<AnalystNote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => {
    requestId.current += 1
    activeRequest.current?.abort()
  }, [])

  const generate = async () => {
    const refresh = Boolean(note || error)
    const current = ++requestId.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setLoading(true)
    setNote(null)
    setError(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetch(`/api/windows/${windowId}/note${refresh ? '?refresh=true' : ''}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          })
          if (!response.ok) throw new Error(`Could not generate analyst note (status ${response.status}). Try again.`)
          const value: unknown = await response.json()
          if (!completeReport(value, windowId)) throw new Error('The note service returned an incomplete report. Try again.')
          return value
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Gemma took longer than 75 seconds. Check that local Ollama is running, then try again.'))
            controller.abort()
          }, 75000)
        }),
      ])
      if (current === requestId.current) setNote(result)
    } catch (cause) {
      if (current !== requestId.current) return
      const message = cause instanceof Error ? cause.message : ''
      // Only our own readable messages are displayed, never arbitrary exceptions.
      setError(/^(Could not generate analyst note \(status \d+\)\. Try again\.|The note service returned an incomplete report\. Try again\.|Gemma took longer than 75 seconds\.)/.test(message)
        ? message : 'Could not reach the analyst note service. Check that the Argus API is running on port 8000, then try again.')
    } finally {
      clearTimeout(timer)
      if (current === requestId.current) setLoading(false)
    }
  }

  return <section className="analyst-report" aria-label={`Analyst report for window #${windowId}`}>
    <div className="analyst-report-controls">
      <span>Window #{windowId} · benchmark analyst report</span>
      <button className="note-generate-btn" disabled={loading} onClick={generate}>
        {loading ? 'Generating…' : error ? 'Try again' : note ? 'Regenerate analyst note' : buttonLabel}
      </button>
    </div>
    {loading && <div className="note-loading" role="status"><span className="loading-mark" aria-hidden="true" /> Generating analyst note… Local Gemma may take up to a minute. The report will appear here.</div>}
    {error && <div className="note-error" role="alert"><strong>Error generating note</strong><p>{error}</p></div>}
    {!loading && !error && !note && <p className="note-hint">Generate a report to see Gemma’s summary, reasoning, suggested checks, and verification caveat here.</p>}
    {note && <article className="note-panel">
      <div className="note-panel-source"><span className={`note-source-badge ${note.source}`}>{note.source === 'gemma' ? 'Gemma' : 'Template fallback'}</span>{note.model && <span>{note.model}</span>}</div>
      {note.source === 'template' && <p className="note-hint">Local Gemma did not return a complete report. This is a template; use Regenerate to retry Gemma.</p>}
      <h3>Threat Summary</h3><p>{note.threat_summary}</p>
      <h3>Why Suspicious</h3><p>{note.why_suspicious}</p>
      <h3>Suggested Checks</h3><ul>{note.suggested_checks.map((check, index) => <li key={index}>{check}</li>)}</ul>
      <p className="note-caveat">{note.caveat}</p>
    </article>}
  </section>
}
