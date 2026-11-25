import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('imports synthetic Zeek, reviews a source record and downloads a persistent case', async ({ page }, testInfo) => {
  const title = `Synthetic connection review ${Date.now()}`
  await page.goto('/investigation')
  await expect(page.getByRole('heading', { name: 'Investigation workspace' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Sensor', exact: true }).selectOption('lab')
  await page.getByRole('button', { name: 'Use synthetic sample' }).click()
  await page.getByRole('button', { name: 'Import log' }).click()

  const imports = page.getByRole('region', { name: 'Recent imports' })
  await expect(imports.getByRole('status')).toContainText('completed')
  const count = async (label: string) => Number(await imports.getByText(label, { exact: true }).locator('..').locator('dd').textContent())
  const accepted = await count('Accepted')
  expect([0, 3]).toContain(accepted)
  expect(await count('Rejected')).toBe(1)
  expect(await count('Duplicates')).toBe(4 - accepted)

  const timeline = page.getByRole('region', { name: 'Observation timeline' })
  await expect(timeline.getByText(/Baseline unavailable/)).toBeVisible()
  await timeline.getByText('View coverage intervals').click()
  await expect(timeline.getByRole('row').filter({ hasText: /10:01.*Verified quiet/ })).toContainText('0')
  await expect(timeline.getByRole('row').filter({ hasText: /10:04.*Unknown coverage/ })).toContainText('Unknown')
  await page.getByLabel('Endpoint IP').fill('192.0.2.10')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(timeline.getByRole('button', { name: 'Open CSample3' })).toHaveCount(0)
  const record = timeline.getByRole('button', { name: 'Open CSample1' })
  await record.focus()
  await page.keyboard.press('Enter')

  const evidence = page.getByRole('region', { name: 'Evidence detail' })
  await expect(evidence.getByRole('heading', { name: 'Evidence detail' })).toBeFocused()
  await expect(evidence.getByText('2026-11-25 10:00:05.5Z')).toBeVisible()
  await expect(evidence.getByText('zeek-conn-synthetic-v1.jsonl · line 2').first()).toBeVisible()
  const screenshots = process.env.ARGUS_INVESTIGATION_SCREENSHOTS
  if (screenshots) await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const fit = await record.evaluate(button => {
    const boundary = button.closest('.inv-table-wrap')!.getBoundingClientRect()
    return button.getBoundingClientRect().right <= boundary.right
  })
  expect(fit).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  if (screenshots) await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 960 })
  await evidence.getByRole('button', { name: 'Attach to case' }).click()
  await page.getByLabel('Case title').fill(title)
  await page.getByRole('combobox', { name: 'Disposition', exact: true }).selectOption('expected')
  await page.getByLabel('Reason').fill('Matches the simulated HTTPS session')
  await page.getByRole('button', { name: 'Save case' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.reload()
  await page.getByRole('combobox', { name: 'Open saved case' }).selectOption({ label: title })
  await expect(page.getByText(/Matches the simulated HTTPS session/)).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Markdown brief' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^argus-case-[a-f0-9]+\.md$/)
  const markdown = await readFile((await download.path())!, 'utf8')
  for (const fragment of ['10:00:05.500000Z', '**Expected**', 'CSample1', 'line 2', '## Coverage caveats']) {
    expect(markdown).toContain(fragment)
  }

  await page.getByRole('combobox', { name: 'Local test identity' }).selectOption('beta-analyst')
  await expect(page.getByText('Saved investigations appear here.')).toBeVisible()
  await expect(page.getByText('Import a synthetic export to start a timeline.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Local test identity' }).selectOption('alpha-viewer')
  await page.getByRole('combobox', { name: 'Open saved case' }).selectOption({ label: title })
  await expect(page.getByText(/Matches the simulated HTTPS session/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Markdown brief' })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Saved cases' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
