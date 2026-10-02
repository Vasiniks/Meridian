import { FREE_SPIN_U, LINEUP_COUNT, LINEUP_PIN, LINEUP_VH, RING_SNAPS, ringTarget } from '../data/scroll'
import { VARIANT_ORDER, type VariantName } from '../three/finishes'

/**
 * Lineup navigation shared by the DOM overlay (Lineup.tsx), the 3D ring
 * (three/ring.ts) and the static fallback (FrameFallback.tsx).
 *
 * Up to FREE_SPIN_U, scroll position is the single source of truth for
 * which variant is in front: clicks, drags and the dial scroll the page to
 * a detent. While such a programmatic scroll is in flight the ring holds
 * the requested variant (`nav.hold`) so it doesn't spin through the
 * detents it passes on the way.
 *
 * Past FREE_SPIN_U (the end of the page) the ring spins freely: `spin` adds
 * an unbounded whole-detent offset on top of the scroll mapping. Wheel or
 * swipe past the bottom steps it one variant per ~notch; drags, the dial
 * and clicks set it directly. Scrolling up is never intercepted.
 */
export const nav = {
  /** variant index the ring holds in front while a programmatic scroll runs (-1 = none) */
  hold: -1,
  /** scroll target of that programmatic scroll */
  holdY: 0,
  /** performance.now() when the hold started */
  holdT: 0,
}

export const variantIndex = (name: string): number => {
  const i = VARIANT_ORDER.indexOf(name as VariantName)
  return i < 0 ? 0 : i
}

/** Absolute (document) top of #lineup in px, or null when it isn't mounted. */
export function lineupTop(): number | null {
  const sec = document.getElementById('lineup')
  if (!sec) return null
  return sec.getBoundingClientRect().top + window.scrollY
}

/** Keep the pinned section's height (and the #order marker) in sync with the detent layout. */
export function sizeLineup(vh = window.innerHeight): void {
  const sec = document.getElementById('lineup')
  if (sec) sec.style.height = `${Math.round(vh * LINEUP_VH)}px`
  const mark = document.getElementById('order')
  if (mark) mark.style.top = `${Math.round(vh * FREE_SPIN_U)}px`
}

/** Section-local scroll position (viewport heights from pin start). */
export function lineupU(scrollY = window.scrollY): number {
  const top = lineupTop()
  if (top === null) return -1e3
  return (scrollY - top) / Math.max(1, window.innerHeight)
}

/** Document scrollY that parks variant `i` in front of the ring. */
export function detentY(i: number): number {
  const top = lineupTop() ?? 0
  const u = RING_SNAPS[Math.max(0, Math.min(RING_SNAPS.length - 1, i))]
  return Math.round(top + Math.min(LINEUP_PIN, u) * window.innerHeight)
}

interface LenisLike {
  scrollTo: (y: number, o?: { duration?: number; immediate?: boolean }) => void
}

/** Scroll the document, through Lenis when the FX layer installed it. */
export function scrollToY(y: number, smooth = true): void {
  const lenis = (window as unknown as { __lenis?: LenisLike }).__lenis
  if (lenis && typeof lenis.scrollTo === 'function') {
    lenis.scrollTo(y, smooth ? { duration: 1.1 } : { immediate: true })
    return
  }
  window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'instant' })
}

const reduced = (): boolean =>
  document.body.classList.contains('reduced') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Park variant `i` in front (smooth scroll to its detent, ring holds it). */
export function gotoDetent(i: number): void {
  const y = detentY(i)
  nav.hold = i
  nav.holdY = y
  nav.holdT = performance.now()
  scrollToY(y, !reduced())
}

export function releaseHold(): void {
  nav.hold = -1
}

// ---- free spin (end of page) --------------------------------------------

export const spin = {
  /** whole-detent offset added to the scroll-mapped ring position (unbounded) */
  target: 0,
  /** scroll travel (px) banked toward the next step */
  acc: 0,
  /** performance.now() of the last spin input / step */
  lastInput: 0,
  lastStep: 0,
}
// QA / debugging handle, like window.__exp
;(window as unknown as { __spin?: typeof spin }).__spin = spin

/** Scroll travel past the bottom that turns the ring one variant (~one wheel notch). */
const STEP_PX = 90
/** Fastest stepping rate, so a long trackpad flick doesn't race round. */
const STEP_MIN_MS = 160
/** Upward finger travel past the bottom that turns the ring one variant. */
const SWIPE_PX = 70

/** True when the page can't scroll any further down. */
export function atPageEnd(): boolean {
  const max = document.documentElement.scrollHeight - window.innerHeight
  return window.scrollY >= max - 2
}

/** True while the lineup sits in its free-spin stretch (end of page). */
export function inFreeSpin(scrollY = window.scrollY): boolean {
  return lineupU(scrollY) >= FREE_SPIN_U
}

/**
 * Scroll travel past the bottom (wheel / swipe, px, positive = down) turns
 * the ring one variant per STEP_PX. Steps are whole detents, so discrete
 * mouse-wheel notches and continuous trackpad streams behave the same.
 */
export function spinScroll(px: number): void {
  const now = performance.now()
  spin.lastInput = now
  spin.acc = Math.min(spin.acc + px, STEP_PX * 1.5)
  if (spin.acc >= STEP_PX && now - spin.lastStep >= STEP_MIN_MS) {
    spin.target += 1
    spin.acc -= STEP_PX
    spin.lastStep = now
  }
}

/**
 * Swipe past the bottom: `travel` is the finger's total upward travel (px)
 * since touchstart and `done` the steps already taken for it. Counting from
 * the gesture start makes it independent of touchmove event rate. Returns
 * the new step count.
 */
export function spinSwipe(travel: number, done: number): number {
  const want = Math.floor(Math.max(0, travel) / SWIPE_PX)
  if (want > done) spin.target += want - done
  spin.acc = ((Math.max(0, travel) % SWIPE_PX) / SWIPE_PX) * STEP_PX * 0.9
  spin.lastInput = performance.now()
  return Math.max(done, want)
}

/** Free-spin offset to render: whole steps plus a small live nudge of the banked travel. */
export function spinPos(): number {
  return spin.target + Math.max(0, Math.min(1, spin.acc / STEP_PX)) * 0.3
}

/** Spin the shortest way round until variant `i` is in front. */
export function spinTo(i: number): void {
  const pos = ringTarget(lineupU()) + spin.target
  const cur = ((Math.round(pos) % LINEUP_COUNT) + LINEUP_COUNT) % LINEUP_COUNT
  let d = i - cur
  if (d > LINEUP_COUNT / 2) d -= LINEUP_COUNT
  if (d < -LINEUP_COUNT / 2) d += LINEUP_COUNT
  spin.target = Math.round(spin.target) + d
  spin.acc = 0
  spin.lastInput = performance.now()
}

/**
 * Per-frame settle (ring.ts, or FrameFallback in static mode). Once input
 * pauses the free spin lands on a whole variant; outside the free-spin
 * stretch it resolves to a whole turn, so the scroll mapping shows the
 * same variant again.
 */
export function spinTick(now = performance.now()): void {
  if (now - spin.lastInput < 200) return
  spin.acc = 0
  const whole = inFreeSpin()
    ? Math.round(spin.target)
    : LINEUP_COUNT * Math.round(spin.target / LINEUP_COUNT)
  if (whole !== spin.target) spin.target = whole
}
