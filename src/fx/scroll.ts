import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { bus } from './bus'
import { addTask, wake } from './ticker'
import { motion } from '../motion/flag'
import { clamp, damp, easeInOutQuart } from '../motion/math'

/**
 * Smooth scroll (Lenis 1.3, its own autoRaf: the 3D loop sleeps when idle,
 * so Lenis keeps ticking on its own) + the shared scroll snapshot that the
 * DOM effects read every frame. Native scroll events are the single input,
 * so everything also works with Lenis off (reduced motion / motion toggle).
 */
export const scroll = {
  /** window.scrollY (Lenis-animated when smoothing is on) */
  y: 0,
  /** max scrollable distance */
  max: 1,
  /** y / max */
  p: 0,
  /** viewport height */
  vh: 1,
  /** monotonically increasing; bumped on every scroll event */
  seq: 0,
  /** smoothed, normalised scroll velocity -1..1 (≈2400 px/s = 1) */
  vs: 0,
  /** last scroll direction: 1 down, -1 up */
  dir: 1,
}

type GeometryFn = () => void
const geometryFns = new Set<GeometryFn>()

let lenis: Lenis | null = null
let locked = false
let roTimer = 0

declare global {
  interface Window {
    __lenis?: Lenis | null
  }
}

function measure(): void {
  scroll.vh = window.innerHeight
  scroll.max = Math.max(1, document.documentElement.scrollHeight - scroll.vh)
  scroll.y = window.scrollY
  scroll.p = clamp(scroll.y / scroll.max, 0, 1)
}

/** Re-measure document height, resize Lenis, and let listeners re-cache rects. */
export function refreshScroll(): void {
  measure()
  lenis?.resize()
  geometryFns.forEach((fn) => fn())
  scroll.seq++
  wake()
}

/** Register a geometry re-cache callback (called on resize / height change). */
export function onGeometry(fn: GeometryFn): () => void {
  geometryFns.add(fn)
  return () => geometryFns.delete(fn)
}

function createLenis(): void {
  if (lenis) return
  lenis = new Lenis({
    lerp: 0.09,
    wheelMultiplier: 0.9,
    smoothWheel: true,
    syncTouch: false,
    // anchors are handled below (same smooth scroll + focus management)
    anchors: false,
    stopInertiaOnNavigate: true,
    autoRaf: true,
  })
  if (locked) lenis.stop()
  window.__lenis = lenis
}

function destroyLenis(): void {
  lenis?.destroy()
  lenis = null
  window.__lenis = null
}

function focusTarget(el: HTMLElement): void {
  if (!el.matches('a[href],button,input,select,textarea,[tabindex]')) {
    el.setAttribute('tabindex', '-1')
  }
  el.focus({ preventScroll: true })
}

/** Smoothly scroll to an element (or y), then move focus there. */
export function scrollToTarget(el: HTMLElement): void {
  const top = el.getBoundingClientRect().top + window.scrollY
  const dist = Math.abs(top - window.scrollY) / Math.max(1, scroll.vh)
  if (lenis && motion.ok) {
    lenis.scrollTo(el, {
      duration: clamp(0.9 + dist * 0.1, 0.9, 2.2),
      easing: easeInOutQuart,
      onComplete: () => focusTarget(el),
    })
  } else {
    window.scrollTo({ top, behavior: 'auto' })
    focusTarget(el)
  }
}

function onAnchorClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return
  }
  const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null
  if (!a) return
  const id = decodeURIComponent(a.hash.slice(1))
  const el = id ? document.getElementById(id) : null
  if (!el) return
  e.preventDefault()
  if (location.hash !== a.hash) history.pushState(null, '', a.hash)
  scrollToTarget(el)
}

/** Stop / resume user scrolling (preloader). */
export function lockScroll(on: boolean): void {
  locked = on
  document.documentElement.classList.toggle('scroll-locked', on)
  if (!lenis) return
  if (on) lenis.stop()
  else lenis.start()
}

// velocity: one damped read per frame, shared by marquee / rules
let velY = 0
function tickVelocity(dt: number): boolean {
  const y = scroll.y
  const v = dt > 0 ? (y - velY) / dt : 0
  velY = y
  if (Math.abs(v) > 1) scroll.dir = v > 0 ? 1 : -1
  scroll.vs = damp(scroll.vs, clamp(v / 2400, -1, 1), 6, dt)
  if (v === 0 && Math.abs(scroll.vs) < 0.0005) {
    scroll.vs = 0
    return false
  }
  return true
}

export function startScroll(): () => void {
  measure()
  velY = scroll.y
  if (motion.ok) createLenis()
  const offVel = addTask(tickVelocity)

  const onNative = (): void => {
    scroll.y = window.scrollY
    scroll.p = clamp(scroll.y / scroll.max, 0, 1)
    scroll.seq++
    wake()
  }
  let resizeRaf = 0
  const onResize = (): void => {
    // run after the experience's own resize handler (it sets #lineup height)
    cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(refreshScroll)
  }
  // document height changes (lineup height set in JS, fonts, images)
  const ro = new ResizeObserver(() => {
    clearTimeout(roTimer)
    roTimer = window.setTimeout(refreshScroll, 120)
  })
  ro.observe(document.body)
  const offMotion = bus.on('motion', ({ ok }) => {
    if (ok) createLenis()
    else destroyLenis()
  })

  window.addEventListener('scroll', onNative, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('click', onAnchorClick)
  return () => {
    offVel()
    offMotion()
    ro.disconnect()
    window.removeEventListener('scroll', onNative)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('click', onAnchorClick)
    destroyLenis()
  }
}
