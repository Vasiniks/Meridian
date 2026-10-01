/**
 * Small, allocation-free motion helpers for the LOOK modules.
 * Kept local (not src/motion/) so the look layer has no merge dependency on
 * the DOM effects branch. Same formulas as the shared motion tokens:
 * frame-rate independent damping and a semi-implicit spring.
 */

export const clamp = (x: number, a: number, b: number): number =>
  x < a ? a : x > b ? b : x

/** Exponential smoothing toward `b`. λ: 4 heavy object · 8 UI · 18 cursor. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-lambda * dt))

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export interface Spring {
  x: number
  v: number
}

/**
 * Semi-implicit Euler spring (mass 1), sub-stepped so a long frame (tab
 * switch, slow GPU) can't explode it. Critical damping: c = 2·√k.
 */
export function springTo(
  s: Spring,
  target: number,
  k: number,
  c: number,
  dt: number,
): number {
  const n = dt > 1 / 90 ? Math.ceil(dt * 90) : 1
  const h = dt / n
  for (let i = 0; i < n; i++) {
    const a = -k * (s.x - target) - c * s.v
    s.v += a * h
    s.x += s.v * h
  }
  return s.x
}

/** Spring has (visually) come to rest at `target`. */
export const springSettled = (s: Spring, target: number, eps = 1e-4): boolean =>
  Math.abs(s.x - target) < eps && Math.abs(s.v) < eps
