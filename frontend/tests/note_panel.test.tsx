import React from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'
import AnalystReport from '../src/AnalystReport'

const fixtureData = {
  health: { ok: true, artifacts: true, ollama: false, mode: 'fixtures' },
  meta: {
    run_id: 'argus-fixture-run',
    dataset: 'UNSW_NB15',
    dataset_source: 'local',
    dataset_citation: 'Test',
    window_seconds: 1,
    lookback_windows: 5,
    min_malicious_flows: 1,
    default_model: 'rf',
    default_threshold: 0.5,
    observation_policy: 'test',
    split: { train_end_ts: 10, val_end_ts: 20, test_start_ts: 20 },
    generated_at: '2026-10-10T00:00:00Z',
  },
  windows: [
    {
      id: 0,
      sequence_id: 'seq_1',
      start_ts: 20,
      end_ts: 21,
      risk: 0.85,
      flagged: true,
      truth_next: 1,
      evaluation_stage: 'Reconnaissance',
      explanation_available: true,
    },
  ],
  metrics: {
    run_id: 'argus-fixture-run',
    test_windows: 1,
    positive_rate: 1.0,
    attack_onset_windows: 1,
    continuation_windows: 0,
    threshold_policy: 'val',
    models: [
      {
        name: 'rf',
        threshold: 0.5,
        precision: 0.9,
        recall: 0.8,
        f1: 0.85,
        fpr: 0.05,
        pr_auc: 0.92,
        onset_recall: 0.75,
        latency_ms_per_window: 1.2,
        confusion: { tp: 10, fp: 1, tn: 20, fn: 2 },
      },
    ],
    notes: [],
  },
}

const windowDetailData = {
  id: 0,
  sequence_id: 'seq_1',
  start_ts: 20,
  end_ts: 21,
  split: 'test',
  risk: 0.85,
  risk_by_model: { rf: 0.85 },
  flagged: true,
  truth_now: 1,
  truth_next: 1,
  evaluation_attack_category: 'Fuzzers',
  evaluation_stage: 'Reconnaissance',
  explanation_available: true,
  top_features: [{ name: 'dur', value: 0.5, shap: 0.12 }],
  counts: { flows: 10, bytes: 500, packets: 5, unique_src: 1, unique_dst: 1, unique_dst_ports: 1 },
}

describe('Frontend Note Panel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('displays the dashboard report even when the window-detail request would fail, and supports regeneration', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.health) })
      if (url.includes('/api/meta')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.meta) })
      if (url.includes('/api/timeline')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.windows) })
      if (url.includes('/api/metrics')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.metrics) })
      if (url === '/api/windows/0' && !options?.method) {
        return Promise.reject(new Error('Window detail unavailable'))
      }
      if (url.startsWith('/api/windows/0/note') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              window_id: 0,
              source: 'gemma',
              model: 'gemma4:e2b-mlx',
              threat_summary: 'Anomalous burst in flow duration',
              why_suspicious: 'Significant duration deviation from baseline',
              suggested_checks: ['Verify host connectivity', 'Review firewall logs'],
              caveat: 'Automated note. Verify before acting.',
            }),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    // The report must not depend on opening or loading a separate window modal.
    const reportButton = await screen.findByRole('button', { name: 'Generate Gemma report' })
    fireEvent.click(reportButton)

    // Verify note is rendered
    await screen.findByText('Anomalous burst in flow duration')
    expect(screen.getByText('Significant duration deviation from baseline')).toBeInTheDocument()
    expect(screen.getByText('Verify host connectivity')).toBeInTheDocument()
    expect(screen.getByText('Review firewall logs')).toBeInTheDocument()
    expect(screen.getByText('Automated note. Verify before acting.')).toBeInTheDocument()
    expect(screen.getByText('Gemma')).toBeInTheDocument()
    expect(screen.getByText('gemma4:e2b-mlx')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/windows/0/note', expect.objectContaining({ method: 'POST' }))
    expect(screen.queryByText('Window #0 Inspection')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/windows/0')
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate analyst note' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/windows/0/note?refresh=true', expect.objectContaining({ method: 'POST' })))
  })

  it('renders template fallback badge when source is template', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.health) })
      if (url.includes('/api/meta')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.meta) })
      if (url.includes('/api/timeline')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.windows) })
      if (url.includes('/api/metrics')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.metrics) })
      if (url === '/api/windows/0' && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(windowDetailData) })
      }
      if (url === '/api/windows/0/note' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              window_id: 0,
              source: 'template',
              model: null,
              threat_summary: 'Automated fallback summary',
              why_suspicious: 'Pattern deviation',
              suggested_checks: ['Check alert logs'],
              caveat: 'Automated note. Verify before acting.',
            }),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const quickBtn = await screen.findByRole('button', { name: /^#0 ·/ })
    fireEvent.click(quickBtn)

    const generateBtn = await screen.findByText('Generate analyst note')
    fireEvent.click(generateBtn)

    await screen.findByText('Template fallback')
    expect(screen.getByText('Automated fallback summary')).toBeInTheDocument()
  })

  it('handles error state cleanly without raw stack traces', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.health) })
      if (url.includes('/api/meta')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.meta) })
      if (url.includes('/api/timeline')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.windows) })
      if (url.includes('/api/metrics')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fixtureData.metrics) })
      if (url === '/api/windows/0' && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(windowDetailData) })
      }
      if (url === '/api/windows/0/note' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: 'Traceback (most recent call last):\n  File "backend/app/main.py", line 4, in note\nRuntimeError: secret internals' }),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const quickBtn = await screen.findByRole('button', { name: /^#0 ·/ })
    fireEvent.click(quickBtn)

    const generateBtn = await screen.findByText('Generate analyst note')
    fireEvent.click(generateBtn)

    await screen.findByText(/Could not generate analyst note \(status 503\)/)
    expect(screen.queryByText(/Traceback|secret internals/)).not.toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})

const validNote = {
  window_id: 0, source: 'gemma', model: 'gemma4:e2b-mlx', threat_summary: 'Report A',
  why_suspicious: 'Review these observations', suggested_checks: ['Check traffic'], caveat: 'Verify before acting',
}

describe('Analyst report request handling', () => {
  it('shows loading immediately and gives a retry after a request stalls', async () => {
    vi.useFakeTimers()
    try {
      const transport = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(() => {}))
      vi.stubGlobal('fetch', transport)
      render(<AnalystReport windowId={0} />)
      fireEvent.click(screen.getByRole('button', { name: 'Generate analyst note' }))
      expect(screen.getByRole('status')).toHaveTextContent('Generating analyst note')
      await act(async () => { await vi.advanceTimersByTimeAsync(75000) })
      expect(screen.getByRole('alert')).toHaveTextContent('Gemma took longer than 75 seconds')
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
      expect(transport.mock.calls[0][1].signal?.aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it.each([
    { ...validNote, window_id: 5 },
    { ...validNote, suggested_checks: [] },
    { ...validNote, threat_summary: '' },
    { ...validNote, model: null },
  ])('shows a readable error for an incomplete or mismatched response %#', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => value })))
    render(<AnalystReport windowId={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate analyst note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incomplete report')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('handles disconnection without exposing exceptions and retries a fresh request', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('Traceback: internal secret'))
      .mockResolvedValueOnce({ ok: true, json: async () => validNote })
    vi.stubGlobal('fetch', transport)
    render(<AnalystReport windowId={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate analyst note' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Argus API is running on port 8000')
    expect(screen.queryByText(/Traceback|internal secret/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Report A')).toBeVisible()
    expect(transport).toHaveBeenLastCalledWith('/api/windows/0/note?refresh=true', expect.anything())
  })

  it('cancels window A and prevents its late report from replacing window B', async () => {
    let finishA!: (value: unknown) => void
    const transport = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishA = resolve }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...validNote, window_id: 1, threat_summary: 'Report B' }) })
    vi.stubGlobal('fetch', transport)
    const view = render(<AnalystReport key={0} windowId={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate analyst note' }))
    view.rerender(<AnalystReport key={1} windowId={1} />)
    expect(transport.mock.calls[0][1].signal.aborted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Generate analyst note' }))
    expect(await screen.findByText('Report B')).toBeVisible()
    await act(async () => { finishA({ ok: true, json: async () => validNote }) })
    expect(screen.queryByText('Report A')).not.toBeInTheDocument()
    expect(screen.getByText('Report B')).toBeVisible()
  })
})
