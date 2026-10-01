/**
 * Motion maths shared by the DOM effects layer (and free for the 3D side).
 * Everything is frame-rate independent; clamp dt to MAX_DT before use so a
 * tab switch never explodes a spring.
 */

/** Longest frame step any integrator should see (seconds). */
export const MAX_DT = 1 / 30

export const clamp = (x: number, a: number, b: number): number =>
  x < a ? a : x > b ? b : x

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Exponential smoothing toward `b` (Lenis uses the same form).
 * λ guide: 4 heavy object · 8 UI follow · 18 cursor ring · 35 near-instant.
 */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-lambda * dt))

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Mutable 1D spring state (mass 1). */
export interface Spring1 {
  x: number
  v: number
}

/**
 * Semi-implicit Euler spring step; mutates and returns `s.x`.
 * Critical damping is c = 2√k; ζ≈0.75–0.9 reads "precise" (tiny overshoot).
 * Presets: cursor ring k=320,c=30 · magnetic k=180,c=18.
 */
export function spring(s: Spring1, target: number, k: number, c: number, dt: number): number {
  const a = -k * (s.x - target) - c * s.v
  s.v += a * dt
  s.x += s.v * dt
  return s.x
}

/** True when a spring is visually at rest on its target. */
export const settled = (s: Spring1, target: number, eps = 0.02): boolean =>
  Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 4

// ---- easing (mirror the CSS tokens in tokens.css) ------------------------
/** expo.out — reveals, rolls (--ease-out) */
export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
/** quart.inOut — wipes, curtains (--ease-inout) */
export const easeInOutQuart = (t: number): number =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2
/** cubic.inOut — hairline / SVG draw-ons (--ease-draw) */
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
