import { test, expect } from '@playwright/test'

const delayedHealth = async (route: import('@playwright/test').Route) => {
  await new Promise(resolve => setTimeout(resolve, 300))
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, artifacts: true, ollama: false, mode: 'fixtures' }) })
}

test('demo flow works at desktop and tablet widths with Ollama off', async ({ page }) => {
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  await expect(page.getByText('ILLUSTRATIVE UI FIXTURE — NOT BENCHMARK RESULTS')).toBeVisible()
  const modelSelect = page.getByRole('combobox', { name: 'Dashboard model' })
  await expect(modelSelect).toBeVisible()
  const apiData = await page.evaluate(async () => {
    const [timelineResponse, metricsResponse] = await Promise.all([fetch('/api/timeline?split=test'), fetch('/api/metrics')])
    return { windows: await timelineResponse.json(), metrics: await metricsResponse.json() }
  })
  const lineShapes: string[] = []
  const kpis = page.getByRole('region', { name: 'Test-period indicators' })
  for (const model of ['rf', 'lr_current', 'lr_lag', 'oracle_persistence']) {
    await modelSelect.selectOption(model)
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1)
    const threshold = model === 'oracle_persistence' ? 0.5 : apiData.metrics.models.find((entry: { name: string }) => entry.name === model).threshold
    const expectedFlags = apiData.windows.filter((window: { risk_by_model: Record<string, number> }) => window.risk_by_model[model] >= threshold).length
    await expect(kpis.locator('.kpi').nth(1).locator('.kpi-value')).toHaveText(String(expectedFlags))
    await expect(page.getByText(new RegExp(`${model === 'oracle_persistence' ? 'Diagnostic boundary' : 'Threshold'} ${threshold.toFixed(2)}`))).toBeVisible()
    lineShapes.push((await page.locator('path.recharts-line-curve').getAttribute('d')) ?? '')
  }
  expect(new Set(lineShapes).size).toBeGreaterThan(1)
  await expect(page.getByRole('option', { name: /non-deployable, diagnostic only/ })).toBeAttached()

  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(300)
    const geometry = await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.pause()
      const chart = document.querySelector('.recharts-surface')!.getBoundingClientRect()
      return { scroll: document.documentElement.scrollWidth, chartWidth: chart.width, right: chart.right, left: chart.left }
    })
    expect(geometry.scroll).toBeLessThanOrEqual(width)
    expect(geometry.chartWidth).toBeGreaterThan(400)
    expect(geometry.right).toBeLessThanOrEqual(width)
    expect(geometry.left).toBeGreaterThanOrEqual(0)
  }

  await page.getByRole('button', { name: /^#\d+ ·/ }).first().click()
  await expect(page.getByText(/Window #\d+ Inspection/)).toBeVisible()
  await expect(page.getByText('TOP SHAP EXPLANATION (RANDOM FOREST)')).toBeVisible()
  await page.getByRole('button', { name: /Generate analyst note/ }).click()
  await expect(page.getByText('Template fallback')).toBeVisible()
  await expect(page.locator('.note-panel')).toContainText('Threat Summary')
  await expect(page.locator('.note-panel')).toContainText('Why Suspicious')
  await expect(page.locator('.note-panel')).toContainText('Suggested Checks')
  await expect(page.locator('.note-panel')).toContainText('Automated note. Verify before acting.')
  await page.getByRole('button', { name: /Close/ }).click()

  await page.getByRole('link', { name: /Models/ }).click()
  await expect(page.getByRole('heading', { name: 'Model comparison' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768)
  for (const label of ['Oracle persistence', 'Current-window LR', 'Lagged LR', 'Random Forest']) await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible()
  await expect(page.getByRole('img', { name: /model comparison chart/ })).toBeVisible()

  await page.getByRole('link', { name: /About/ }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768)
  for (const heading of ['Problem', 'Method', 'Dataset citation', 'Chronological split', 'Limitations', 'Claims policy']) await expect(page.getByRole('heading', { name: heading })).toBeVisible()

  expect((await page.locator('body').innerText()).match(/Traceback|TypeError:|ReferenceError:|at\s+\w+\s*\(/)).toBeNull()
  expect(errors).toEqual([])
  expect(requests.filter(url => !new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/))).toEqual([])
})

test('dashboard loading, empty, and error states are readable and never leave a blank chart', async ({ page }) => {
  await page.route('**/api/health', route => delayedHealth(route))
  await page.goto('/')
  await expect(page.getByText('Loading local evaluation…')).toBeVisible()
  await expect(page.getByText('ILLUSTRATIVE UI FIXTURE — NOT BENCHMARK RESULTS')).toBeVisible()

  await page.route('**/api/timeline?split=test', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.reload()
  await expect(page.getByText('No test-period windows available')).toBeVisible()
  await expect(page.locator('.recharts-surface')).toHaveCount(0)

  await page.route('**/api/timeline?split=test', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'internal stack trace must not appear' }) }))
  await page.reload()
  await expect(page.getByText('Evaluation unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry loading dashboard' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('internal stack trace')
})

test('Models loading and empty states are readable', async ({ page }) => {
  await page.route('**/api/health', route => delayedHealth(route))
  await page.goto('/models')
  await expect(page.getByText('Loading model metrics…')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Model comparison' })).toBeVisible()
  await page.route('**/api/metrics', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }))
  await page.reload()
  await expect(page.getByText('No model metrics available')).toBeVisible()
})

test('Models and About errors are readable', async ({ page }) => {
  await page.route('**/api/metrics', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'private stack trace' }) }))
  await page.goto('/models')
  await expect(page.getByText('Model metrics unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry loading metrics' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('private stack trace')

  await page.unrouteAll()
  await page.route('**/api/health', route => delayedHealth(route))
  await page.goto('/about')
  await expect(page.getByText('Loading experiment details…')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'About Argus' })).toBeVisible()
  await page.route('**/api/meta', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'private error' }) }))
  await page.goto('/about')
  await expect(page.getByText('Experiment details unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry loading About' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('private error')
})

test('full real timeline renders without thousands of reference-area registrations', async ({ page }) => {
  const { readFileSync } = await import('node:fs')
  const timeline = JSON.parse(readFileSync('../artifacts/timeline.json', 'utf8'))
  const metrics = JSON.parse(readFileSync('../artifacts/metrics.json', 'utf8'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, artifacts: true, ollama: false, mode: 'artifacts' } }))
  await page.route('**/api/meta', route => route.fulfill({ json: timeline.meta }))
  await page.route('**/api/metrics', route => route.fulfill({ json: metrics }))
  await page.route('**/api/timeline?split=test', route => route.fulfill({ json: timeline.windows }))
  await page.goto('/')
  const line = page.locator('path.recharts-line-curve')
  await expect(line).toBeVisible({ timeout: 20000 })
  const path = await line.getAttribute('d') ?? ''
  expect((path.match(/[MLC]/g) ?? []).length).toBe(timeline.windows.length)
  expect((path.match(/M/g) ?? []).length).toBeGreaterThan(1)
  expect(await page.locator('.chart-container').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(300)
  await expect(page.locator('.flagged-point')).toHaveCount(timeline.windows.filter((window: { risk: number }) => window.risk >= timeline.meta.default_threshold).length)
  await expect(page.locator('.flagged-point').first()).toHaveAttribute('fill', '#ef4444')
  await expect(page.locator('.ground-truth-bands')).toHaveCount(1)
  await expect(page.locator('.recharts-reference-area')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('all real model mappings switch promptly and retain correct KPIs and series', async ({ page }) => {
  const { readFileSync } = await import('node:fs')
  const timeline = JSON.parse(readFileSync('../artifacts/timeline.json', 'utf8'))
  const metrics = JSON.parse(readFileSync('../artifacts/metrics.json', 'utf8'))
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, artifacts: true, ollama: false, mode: 'artifacts' } }))
  await page.route('**/api/meta', route => route.fulfill({ json: timeline.meta }))
  await page.route('**/api/metrics', route => route.fulfill({ json: metrics }))
  await page.route('**/api/timeline?split=test', route => route.fulfill({ json: timeline.windows }))
  await page.goto('/')
  await expect(page.locator('.recharts-line-curve')).toBeVisible()
  const paths = new Set<string>()
  const kpis = page.getByRole('region', { name: 'Test-period indicators' })
  for (const model of ['lr_current', 'lr_lag', 'oracle_persistence', 'rf']) {
    const metric = metrics.models.find((entry: { name: string }) => entry.name === model)
    const threshold = model === 'oracle_persistence' ? 0.5 : metric.threshold
    const start = Date.now()
    await page.getByRole('combobox', { name: 'Dashboard model' }).selectOption(model)
    await expect(kpis.locator('.kpi-value').nth(1)).toHaveText(String(timeline.windows.filter((w: { risk_by_model: Record<string, number> }) => w.risk_by_model[model] >= threshold).length))
    await expect(kpis.locator('.kpi-value').nth(2)).toHaveText(`${(metric.precision * 100).toFixed(1)}%`)
    expect(Date.now() - start, `${model} switch should not freeze the dashboard`).toBeLessThan(2500)
    paths.add(await page.locator('.recharts-line-curve').getAttribute('d') ?? '')
  }
  expect(paths.size).toBe(4)
})
