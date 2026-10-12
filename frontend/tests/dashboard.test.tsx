import { existsSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import timeline from '../../fixtures/timeline.json'
import metrics from '../../fixtures/metrics.json'

const health = { ok: true, artifacts: true, ollama: false, mode: 'fixtures' }
function serve() {
  const responses: Record<string, unknown> = {
    '/api/health': health, '/api/meta': timeline.meta, '/api/timeline?split=test': timeline.windows,
    '/api/metrics': metrics,
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(responses[url]), { status: 200 })))
}

test('fixture dashboard shows five grounded KPIs and the explicit fixture warning', async () => {
  expect(existsSync('src/App.tsx'), 'L1 dashboard is missing').toBe(true)
  serve()
  const modulePath = '../src/App'
  const { default: App } = await import(/* @vite-ignore */ modulePath)
  render(<App />)
  expect(await screen.findByText('ILLUSTRATIVE UI FIXTURE — NOT BENCHMARK RESULTS')).toBeVisible()
  const kpis = screen.getByRole('region', { name: 'Test-period indicators' })
  expect(within(kpis).getAllByRole('article')).toHaveLength(5)
  for (const label of ['Test windows', 'Flagged windows', 'Random Forest precision', 'Random Forest recall', 'Random Forest onset recall']) {
    expect(within(kpis).getByText(label)).toBeVisible()
  }
  expect(within(kpis).getByText(String(metrics.test_windows))).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Next-window risk' })).toBeVisible()
  const riskPanel = screen.getByRole('region', { name: 'Next-window risk' })
  const reportPanel = screen.getByRole('region', { name: 'Gemma analyst report' })
  expect(riskPanel.compareDocumentPosition(reportPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('Evaluation ground truth')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Dashboard model' })).toBeVisible()
  expect(screen.getByRole('link', { name: /Models/ })).toBeEnabled()
  expect(screen.getByRole('link', { name: /About/ })).toBeEnabled()
})

test('test split control explains the available evaluation partition', async () => {
  serve()
  const { default: App } = await import('../src/App')
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Test split details' })).toBeVisible()
})
