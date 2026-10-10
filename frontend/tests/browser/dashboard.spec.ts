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
  await expect(page.locator('.recharts-line-curve')).toHaveCount(1)
  for (const model of ['lr_current', 'lr_lag', 'oracle_persistence']) {
    await modelSelect.selectOption(model)
    await expect(page.getByText(/scores unavailable/)).toBeVisible()
  }
  await modelSelect.selectOption('rf')
  await expect(page.locator('.recharts-line-curve')).toHaveCount(1)
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
