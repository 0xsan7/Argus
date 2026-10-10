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
  for (const window of timeline.windows) {
    const shaded = series[0].truth.some((interval: { start: number; end: number }) => interval.start <= window.end_ts && interval.end >= window.end_ts + 10)
    expect(shaded).toBe(window.truth_next === 1)
  }
  expect(series[0].truth.reduce((duration: number, interval: { start: number; end: number }) => duration + interval.end - interval.start, 0)).toBe(malicious.length * 10)
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

test('contiguous attack windows share one shade without crossing sequence gaps', async () => {
  const { chartSeries, timelinePlotPoints } = await import('../src/timeline')
  const base = { ...timeline.windows[0], truth_next: 1 as const }
  const windows = Array.from({ length: 17240 }, (_, id) => ({ ...base, id, start_ts: id * 10, end_ts: (id + 1) * 10, sequence_id: id < 10000 ? 'a' : 'b' }))
  const series = chartSeries(windows, 10)
  expect(series.flatMap(segment => segment.truth)).toEqual([{ start: 10, end: 100010 }, { start: 100010, end: 172410 }])
  const points = timelinePlotPoints(series, 10)
  expect(points.filter(point => point.risk !== null)).toHaveLength(17240)
  expect(points.filter(point => point.gap)).toHaveLength(1)
})
