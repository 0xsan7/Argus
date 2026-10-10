import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'

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

  it('renders "Generate analyst note" button, handles loading, and displays generated note', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.health) })
      if (url.includes('/api/meta')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.meta) })
      if (url.includes('/api/timeline')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.windows) })
      if (url.includes('/api/metrics')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.metrics) })
      if (url === '/api/windows/0' && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(windowDetailData) })
      }
      if (url === '/api/windows/0/note' && options?.method === 'POST') {
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

    // Inspect window #0 via quick inspect
    const quickBtn = await screen.findByText('Flagged Window #0')
    fireEvent.click(quickBtn)

    // Wait for window modal
    await screen.findByText('Window #0 Inspection')
    const generateBtn = await screen.findByText('Generate analyst note')
    expect(generateBtn).toBeInTheDocument()

    // Click Generate note
    fireEvent.click(generateBtn)

    // Verify note is rendered
    await screen.findByText('Anomalous burst in flow duration')
    expect(screen.getByText('Significant duration deviation from baseline')).toBeInTheDocument()
    expect(screen.getByText('Verify host connectivity')).toBeInTheDocument()
    expect(screen.getByText('Review firewall logs')).toBeInTheDocument()
    expect(screen.getByText('Automated note. Verify before acting.')).toBeInTheDocument()
    expect(screen.getByText('Gemma')).toBeInTheDocument()
    expect(screen.getByText('gemma4:e2b-mlx')).toBeInTheDocument()
  })

  it('renders template fallback badge when source is template', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.health) })
      if (url.includes('/api/meta')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.meta) })
      if (url.includes('/api/timeline')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.windows) })
      if (url.includes('/api/metrics')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.metrics) })
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

    const quickBtn = await screen.findByText('Flagged Window #0')
    fireEvent.click(quickBtn)

    const generateBtn = await screen.findByText('Generate analyst note')
    fireEvent.click(generateBtn)

    await screen.findByText('Template fallback')
    expect(screen.getByText('Automated fallback summary')).toBeInTheDocument()
  })

  it('handles error state cleanly without raw stack traces', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/health')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.health) })
      if (url.includes('/api/meta')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.meta) })
      if (url.includes('/api/timeline')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.windows) })
      if (url.includes('/api/metrics')) return Promise.resolve({ json: () => Promise.resolve(fixtureData.metrics) })
      if (url === '/api/windows/0' && !options?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(windowDetailData) })
      }
      if (url === '/api/windows/0/note' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: 'Service temporarily unavailable' }),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const quickBtn = await screen.findByText('Flagged Window #0')
    fireEvent.click(quickBtn)

    const generateBtn = await screen.findByText('Generate analyst note')
    fireEvent.click(generateBtn)

    await screen.findByText(/Service temporarily unavailable/)
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})
