import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import SignalHero from '../src/SignalHero'
import { silkColor } from '../src/asciiWave'

test('hero keeps its navigation and readable content when canvas is unavailable', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  render(<SignalHero />)
  expect(screen.getByRole('heading', { name: 'Read the signal. Understand the risk.' })).toBeVisible()
  expect(screen.getByRole('link', { name: /Explore timeline/ })).toHaveAttribute('href', '#risk-timeline')
  expect(screen.getByText('Decorative field · not live traffic')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Pause animation' })).toBeDisabled()
  vi.restoreAllMocks()
})

test('procedural silk produces bounded, spatially varying colors that move over time', () => {
  const samples = [silkColor(0.2, 0.7, 0), silkColor(0.8, 0.3, 0), silkColor(0.2, 0.7, 2)]
  for (const rgb of samples) for (const channel of rgb) {
    expect(Number.isFinite(channel)).toBe(true)
    expect(channel).toBeGreaterThanOrEqual(0)
    expect(channel).toBeLessThanOrEqual(255)
  }
  expect(samples[0]).not.toEqual(samples[1])
  expect(samples[0]).not.toEqual(samples[2])
})

test('animation can be paused and resumed, and cleans up on unmount', () => {
  const schedule = vi.fn(() => 1), cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', schedule)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  vi.stubGlobal('matchMedia', () => ({ matches:false, addEventListener:vi.fn(), removeEventListener:vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  const { unmount } = render(<SignalHero />)
  expect(schedule).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name:'Pause animation' }))
  expect(schedule).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name:'Resume animation' }))
  expect(schedule).toHaveBeenCalledTimes(2)
  unmount()
  expect(cancel).toHaveBeenCalledWith(1)
  vi.restoreAllMocks()
})

test('reduced motion renders a static field without starting an animation loop', () => {
  const schedule = vi.fn()
  vi.stubGlobal('requestAnimationFrame', schedule)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('matchMedia', () => ({ matches:true, addEventListener:vi.fn(), removeEventListener:vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  render(<SignalHero />)
  expect(schedule).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name:'Pause animation' })).toBeDisabled()
  vi.restoreAllMocks()
})
