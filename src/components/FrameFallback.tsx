import { useEffect, useRef } from 'react'
import { KEYS, LINEUP_PIN, RING_IN, ringIndex, ringTarget, sstep } from '../data/scroll'
import { asset } from '../assetUrl'
import { bus } from '../fx/bus'
import { VARIANT_ORDER } from '../three/finishes'
import { sizeLineup, spinPos, spinTick } from './lineupNav'

const DESKTOP_COUNT = 80
const MOBILE_COUNT = 60

const frameUrl = (mobile: boolean, i: number): string =>
  asset(`frames/${mobile ? 'mobile' : 'desktop'}/f${String(i).padStart(3, '0')}.jpg`)

function driveDom(p: number): void {
  const fill = document.getElementById('progressFill')
  if (fill) fill.style.transform = `scaleX(${p})`
  document.getElementById('nav')?.classList.toggle('scrolled', window.scrollY > 40)
  let li = 0
  while (li < KEYS.length - 1 && p > KEYS[li + 1].p) li++
  const label = document.getElementById('sceneLabel')
  if (label) label.textContent = KEYS[li].label
  const mechSec = document.getElementById('mechanism')
  if (mechSec) {
    const r = mechSec.getBoundingClientRect()
    const mp = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - r.top) / r.height))
    const si = Math.min(4, Math.floor(mp * 5))
    document.querySelectorAll<HTMLElement>('.step').forEach((s, i) => {
      s.dataset.on = String(i <= si)
    })
  }
}

// ---- lineup (static mode) ----------------------------------------------
// Same section-local mapping as the 3D ring (scroll detents + free-spin
// offset): --ring drives the CSS prism of renders + the dial,
// `variant:active` drives the overlay text. The pre-rendered frames show
// the single pencil, so they fade out while the prism takes over.
let lastLineupIdx = 0
function driveLineup(img: HTMLImageElement | null): void {
  const sec = document.getElementById('lineup')
  if (!sec) return
  const u = -sec.getBoundingClientRect().top / Math.max(1, window.innerHeight)
  spinTick()
  const pos = ringTarget(u) + spinPos()
  const reduced =
    document.body.classList.contains('reduced') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  sec.style.setProperty('--ring', String(reduced ? ringIndex(pos) : Math.round(pos * 1000) / 1000))
  const i = ringIndex(pos)
  if (u > RING_IN[0] && u < LINEUP_PIN + 0.15 && i !== lastLineupIdx) {
    lastLineupIdx = i
    bus.emit('variant:active', { name: VARIANT_ORDER[i] })
  }
  if (img) img.style.opacity = String(1 - sstep(-0.75, -0.25, u))
}

/**
 * Zero-GPU fallback: pre-rendered JPEG frames driven by scroll progress.
 * Used when WebGL is unavailable, on very weak hardware, or ?static=1.
 * All DOM content stays live — only the 3D canvas is replaced.
 */
export default function FrameFallback({ reason = null }: { reason?: string | null }) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const tierRef = useRef({ mobile: false, count: DESKTOP_COUNT })

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const mobile = window.innerWidth <= 700
    const count = mobile ? MOBILE_COUNT : DESKTOP_COUNT
    tierRef.current = { mobile, count }
    let raf = 0
    let lastIdx = -1
    let queued = false

    const show = (idx: number): void => {
      if (idx === lastIdx) return
      lastIdx = idx
      img.src = frameUrl(mobile, idx)
      // keep neighbors warm
      for (const d of [1, 2, -1]) {
        const j = idx + d
        if (j >= 0 && j < count) {
          const pre = new Image()
          pre.src = frameUrl(mobile, j)
        }
      }
    }

    const update = (): void => {
      queued = false
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      show(Math.min(count - 1, Math.floor(p * count)))
      driveDom(p)
      driveLineup(img)
    }
    const onScroll = (): void => {
      if (!queued) {
        queued = true
        raf = requestAnimationFrame(update)
      }
    }

    // free spin changes the ring without scrolling: redraw on its input,
    // and once more after the settle delay (lineupNav.spinTick)
    let settleT = 0
    const onSpinInput = (): void => {
      onScroll()
      window.clearTimeout(settleT)
      settleT = window.setTimeout(onScroll, 220)
    }
    const spinEvents = ['wheel', 'touchmove', 'keydown', 'click', 'pointerup'] as const
    spinEvents.forEach((t) => window.addEventListener(t, onSpinInput, { passive: true }))

    document.body.classList.add('is-static')
    sizeLineup()
    const onResize = (): void => {
      sizeLineup()
      onScroll()
    }
    show(0)
    driveDom(0)
    update()
    document.querySelectorAll('.rv').forEach((el) => {
      const io2 = new IntersectionObserver((es, o) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            o.disconnect()
          }
        }),
      { threshold: 0.18 },
      )
      io2.observe(el)
    })
    const gl = document.getElementById('gl')
    if (gl) gl.style.display = 'none'
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    document.getElementById('loader')?.classList.add('done')
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(settleT)
      spinEvents.forEach((t) => window.removeEventListener(t, onSpinInput))
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      document.body.classList.remove('is-static')
    }
  }, [])

  return (
    <>
    <img
      ref={imgRef}
      id="frameFallback"
      alt=""
      aria-hidden="true"
      src={frameUrl(false, 0)}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100dvh',
        objectFit: 'cover',
        objectPosition: 'center',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
    {reason && (
      <p className="ff-note mono" role="status">
        Still frames · 3D view unavailable here ({reason})
      </p>
    )}
    </>
  )
}
