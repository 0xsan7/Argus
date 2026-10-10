import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import timeline from '../../fixtures/timeline.json'

test('chart places risk at prediction cutoff and truth in the NEXT interval', async () => {
  expect(existsSync('src/timeline.ts'), 'chart interval transform is missing').toBe(true)
  const path = '../src/timeline'
  const { chartSeries } = await import(/* @vite-ignore */ path)
  const series = chartSeries(timeline.windows, timeline.meta.window_seconds)
  expect(series).toHaveLength(1)
  expect(series[0].points[0].targetStart).toBe(10)
  expect(series[0].points[0].targetEnd).toBe(20)
  const malicious = timeline.windows.filter(w => w.truth_next === 1)
  expect(series[0].truth).toEqual(malicious.map(w => ({ start: w.end_ts, end: w.end_ts + 10 })))
  expect(series[0].points.filter((p: { flagged: boolean }) => p.flagged).length).toBe(timeline.windows.filter(w => w.flagged).length)
})

test('chart never joins capture sequences or missing-window gaps', async () => {
  expect(existsSync('src/timeline.ts')).toBe(true)
  const path = '../src/timeline'
  const { chartSeries } = await import(/* @vite-ignore */ path)
  const windows = [
    timeline.windows[0], timeline.windows[1], timeline.windows[5],
    { ...timeline.windows[2], sequence_id: 'another-capture' },
  ]
  const series = chartSeries(windows, 10)
  expect(series).toHaveLength(3)
  expect(series.map((s: { points: unknown[] }) => s.points.length)).toEqual([2, 1, 1])
})
