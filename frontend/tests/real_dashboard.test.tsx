import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import App from '../src/App'
import timeline from '../../artifacts/timeline.json'
import metrics from '../../artifacts/metrics.json'

const health = { ok: true, artifacts: true, ollama: false, mode: 'artifacts' }

function serveReal() {
  const responses: Record<string, unknown> = {
    '/api/health': health,
    '/api/meta': timeline.meta,
    '/api/timeline?split=test': timeline.windows.slice(0, 50),
    '/api/metrics': metrics,
    '/api/windows/0': timeline.windows[0],
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/windows/99999') {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }
    const data = responses[url]
    if (data) {
      return new Response(JSON.stringify(data), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }))
}

test('real data dashboard renders test windows, flagged points, and handles inspections without crashing', async () => {
  serveReal()
  render(<App />)

  // 1. Confirm timeline shows real test-period windows
  expect(await screen.findByText('Test-period overview')).toBeVisible()
  expect(screen.getByText('17240')).toBeVisible()
  expect(screen.getByText('Chronological test partition')).toBeVisible()
  expect(screen.getByText('Next-window risk')).toBeVisible()

  // 2. Confirm flagged windows are visible in KPIs and chart
  expect(screen.getByText('Flagged windows')).toBeVisible()
  const flaggedCount = String(timeline.windows.filter(w => w.flagged).length)
  expect(screen.getByText(flaggedCount)).toBeVisible()

  // 3. Confirm opening a flagged window shows detail view with top features
  const flaggedBtn = screen.getByRole('button', { name: /^#0 ·/ })
  fireEvent.click(flaggedBtn)

  expect(await screen.findByText('Window #0 Inspection')).toBeVisible()
  expect(await screen.findByText('TOP SHAP EXPLANATION (RANDOM FOREST)')).toBeVisible()
  // Check that top features are visible
  const firstFeature = timeline.windows[0].top_features[0]
  if (firstFeature) {
    expect(await screen.findByText(firstFeature.name)).toBeVisible()
  }

  // Close modal
  const closeBtn = screen.getByRole('button', { name: /Close/ })
  fireEvent.click(closeBtn)

  // 4. Confirm opening train or validation window does not crash
  const inspectInput = screen.getByPlaceholderText('Window ID')
  fireEvent.change(inspectInput, { target: { value: '99999' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))

  expect(await screen.findByText('Window #99999 Inspection')).toBeVisible()
  expect(await screen.findByText(/Window #99999 not found in test partition/)).toBeVisible()
})
