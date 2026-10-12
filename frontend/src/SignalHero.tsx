import { useEffect, useRef, useState } from 'react'
import { createAsciiWave } from './asciiWave'

export default function SignalHero() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef(0)
  const [paused, setPaused] = useState(false)
  const [available, setAvailable] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (!canvas.current || !window.matchMedia) return
    const element = canvas.current
    const draw = createAsciiWave(element)
    if (!draw) return
    setAvailable(true)
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, last = -Infinity, visible = true
    const render = (now: number) => {
      if (now - last >= 1000 / 24) {
        elapsed.current += Math.min(now - last, 100) / 1000
        draw(elapsed.current); last = now
      }
      frame = requestAnimationFrame(render)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      setReduced(preference.matches)
      last = -Infinity
      draw(elapsed.current)
      if (!paused && !preference.matches && visible && !document.hidden) frame = requestAnimationFrame(render)
    }
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw(elapsed.current)) : null
    resize?.observe(element)
    const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting; sync()
    }) : null
    intersection?.observe(element)
    preference.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      cancelAnimationFrame(frame); resize?.disconnect(); intersection?.disconnect()
      preference.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [paused])

  return <section className="signal-hero" aria-labelledby="signal-hero-title">
    <div className="signal-hero-art" aria-hidden="true"><canvas ref={canvas} /></div>
    <div className="signal-hero-copy">
      <div className="signal-hero-kicker"><span aria-hidden="true">+</span> ARGUS / SIGNAL INTELLIGENCE</div>
      <h2 id="signal-hero-title">Read the signal.<br /><span>Understand the risk.</span></h2>
      <p>Explore benchmark risk scores, compare models, and turn selected alerts into analyst notes.</p>
      <div className="signal-hero-actions">
        <a className="signal-hero-primary" href="#risk-timeline">Explore timeline <span aria-hidden="true">↗</span></a>
        <a href="/models">Compare models <span aria-hidden="true">→</span></a>
      </div>
    </div>
    <div className="signal-hero-corner" aria-hidden="true">[ ASCII / SILK FIELD ]</div>
    <div className="signal-hero-footer">
      <div className="signal-hero-capabilities"><span>01 / Observe</span><span>02 / Explain</span><span>03 / Evaluate</span></div>
      <div className="signal-hero-motion"><span>Decorative field · not live traffic</span>
        <button type="button" disabled={!available || reduced} onClick={() => setPaused(value => !value)} aria-label={paused ? 'Resume animation' : 'Pause animation'}>
          {reduced || !available ? 'Static' : paused ? '▷ Play' : 'Ⅱ Pause'}
        </button>
      </div>
    </div>
  </section>
}
