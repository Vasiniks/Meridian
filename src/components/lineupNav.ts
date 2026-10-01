import { LINEUP_PIN, LINEUP_VH, RING_SNAPS } from '../data/scroll'
import { VARIANT_ORDER, type VariantName } from '../three/finishes'

/**
 * Lineup navigation shared by the DOM overlay (Lineup.tsx), the 3D ring
 * (three/ring.ts) and the static fallback (FrameFallback.tsx).
 *
 * Scroll position is the single source of truth for which variant is in
 * front: clicks, drags, the dial and the "Choose" CTA all scroll the page
 * to a detent. While such a programmatic scroll is in flight the ring
 * holds the requested variant (`nav.hold`) so it doesn't spin through the
 * detents it passes on the way.
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

/** Keep the pinned section's height in sync with the detent layout. */
export function sizeLineup(vh = window.innerHeight): void {
  const sec = document.getElementById('lineup')
  if (sec) sec.style.height = `${Math.round(vh * LINEUP_VH)}px`
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

/** Document scrollY that brings the Buy form into view. */
export function buyY(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight
  const buy = document.getElementById('buy')
  if (!buy) return max
  const stage = buy.querySelector<HTMLElement>('.buy-grid') ?? buy
  const top = stage.getBoundingClientRect().top + window.scrollY
  return Math.min(max, Math.round(top - Math.min(140, window.innerHeight * 0.14)))
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

/** "Choose {name}": hold that variant in front and scroll on into Buy. */
export function gotoBuy(i: number): void {
  const y = buyY()
  nav.hold = i
  nav.holdY = y
  nav.holdT = performance.now()
  scrollToY(y, !reduced())
}

export function releaseHold(): void {
  nav.hold = -1
}
