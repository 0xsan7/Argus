import { test, expect } from '@playwright/test'
import fixture from '../../../fixtures/timeline.json'

test('live fixture API renders aligned risk, threshold, flags and truth at desktop and tablet', async ({ page }) => {
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => requests.push(r.url()))
  await page.goto('/')
  await expect(page.getByText('ILLUSTRATIVE UI FIXTURE — NOT BENCHMARK RESULTS')).toBeVisible()
  await expect(page.locator('.recharts-line-curve')).toHaveCount(1)
  await expect(page.locator('.recharts-reference-line line')).toHaveCount(1)
  await expect(page.locator('.flagged-point')).toHaveCount(fixture.windows.filter(w => w.flagged).length)
  await expect(page.locator('.recharts-reference-area')).toHaveCount(fixture.windows.filter(w => w.truth_next === 1).length)
  await expect(page.getByText('Target interval start · seconds', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Models/ })).toBeDisabled()
  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForFunction(() => {
      const chart = document.querySelector('.recharts-surface')?.getBoundingClientRect()
      return chart && chart.width > 0
    })
    const geometry = await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.pause()
      const chart = document.querySelector('.recharts-surface')!.getBoundingClientRect()
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, chartWidth: chart.width, right: chart.right, left: chart.left }
    })
    expect(geometry.scroll).toBeLessThanOrEqual(width)
    expect(geometry.chartWidth).toBeGreaterThan(500)
    expect(geometry.right).toBeLessThanOrEqual(width)
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    await page.screenshot({ path: `../runtime/vigil-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
  expect(requests.filter(url => !new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/))).toEqual([])
})
