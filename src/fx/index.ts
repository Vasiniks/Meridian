import { startMotionFlag } from '../motion/flag'
import { startScroll } from './scroll'
import { startPreloader } from './preloader'
import { startGrain } from './grain'
import { startCursor } from './cursor'
import { startReveals } from './reveal'
import { startChrome } from './chrome'
import { startMarquee } from './marquee'
import { stopTicker } from './ticker'

export { scanReveals, revealNow } from './reveal'
export { setOdometer } from './odometer'

declare global {
  interface Window {
    __fx?: boolean
    /** teardown of the running FX instance (survives Vite HMR re-execution) */
    __fxStop?: (() => void) | null
  }
}

let stop: (() => void) | null = null

/**
 * Boot the DOM effects layer (idempotent). Called once from Chrome.tsx.
 * Order matters: motion flag → scroll → preloader (locks scroll) → layers.
 */
export function startFx(): () => void {
  if (stop) return stop
  // a re-executed module (HMR) must not stack a second cursor / Lenis
  window.__fxStop?.()
  window.__fx = true
  const offs = [
    startMotionFlag(),
    startScroll(),
    startPreloader(),
    startGrain(),
    startCursor(),
    startReveals(),
    startChrome(),
    startMarquee(),
  ]
  const self = (): void => {
    offs.reverse().forEach((f) => f())
    stopTicker()
    if (stop === self) stop = null
    if (window.__fxStop === self) window.__fxStop = null
  }
  stop = self
  window.__fxStop = self
  return self
}
