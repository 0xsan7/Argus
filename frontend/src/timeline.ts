export interface TimelineWindowInput {
  id: number
  sequence_id: string
  start_ts: number
  end_ts: number
  risk: number
  flagged: boolean
  truth_next: 0 | 1
  evaluation_stage?: string | null
  explanation_available?: boolean
  risk_by_model?: Partial<Record<import('./types').ModelName, number>>
}

export function selectModelTimeline<T extends TimelineWindowInput>(
  windows: T[],
  model: import('./types').ModelName,
  threshold: number,
  defaultModel: import('./types').ModelName,
): { available: boolean; windows: T[] } {
  const selected = windows.map(window => {
    const score = window.risk_by_model?.[model] ?? (model === defaultModel ? window.risk : undefined)
    if (typeof score !== 'number' || !Number.isFinite(score)) return null
    return { ...window, risk: score, flagged: score >= threshold } as T
  })
  if (selected.some(window => window === null)) return { available: false, windows: [] }
  return { available: true, windows: selected as T[] }
}


export interface ChartPoint extends TimelineWindowInput {
  targetStart: number
  targetEnd: number
}

export interface PlotPoint extends Omit<ChartPoint, 'risk'> {
  risk: number | null
  gap?: boolean
}

export interface TruthInterval {
  start: number
  end: number
}

export interface Series {
  sequence_id: string
  points: ChartPoint[]
  truth: TruthInterval[]
}

export function chartSeries(windows: TimelineWindowInput[], windowSeconds: number): Series[] {
  if (!windows || windows.length === 0) return []

  const seriesList: Series[] = []
  let currentSeries: Series | null = null
  let prevWindow: TimelineWindowInput | null = null

  for (const w of windows) {
    const isContiguous = prevWindow !== null &&
      prevWindow.sequence_id === w.sequence_id &&
      prevWindow.end_ts === w.start_ts

    if (!currentSeries || !isContiguous) {
      currentSeries = {
        sequence_id: w.sequence_id,
        points: [],
        truth: [],
      }
      seriesList.push(currentSeries)
    }

    const point: ChartPoint = {
      ...w,
      targetStart: w.end_ts,
      targetEnd: w.end_ts + windowSeconds,
    }
    currentSeries.points.push(point)

    if (w.truth_next === 1) {
      currentSeries.truth.push({
        start: w.end_ts,
        end: w.end_ts + windowSeconds,
      })
    }

    prevWindow = w
  }

  return seriesList
}

export function timelinePlotPoints(series: Series[], windowSeconds: number): PlotPoint[] {
  return series.flatMap((segment, index) => {
    if (index === 0 || segment.points.length === 0) return segment.points.map(point => ({ ...point }))
    const previous = series[index - 1].points.at(-1)
    if (!previous) return segment.points.map(point => ({ ...point }))
    const separator: PlotPoint = {
      ...previous,
      id: -index,
      targetStart: previous.targetEnd,
      targetEnd: previous.targetEnd + windowSeconds,
      risk: null,
      flagged: false,
      truth_next: 0,
      evaluation_stage: null,
      explanation_available: false,
      gap: true,
    }
    return [separator, ...segment.points.map(point => ({ ...point }))]
  })
}
