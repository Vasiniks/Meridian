import { useEffect, useRef } from 'react'
import { KEYS } from '../data/scroll'
import { asset } from '../assetUrl'

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
  const lineupSec = document.getElementById('lineup')
  const track = document.getElementById('lineupTrack')
  if (lineupSec && track) {
    const r = lineupSec.getBoundingClientRect()
    const total = r.height - window.innerHeight
    const lp = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0
    const dist = Math.max(0, track.scrollWidth - window.innerWidth + 60)
    track.style.transform = `translate3d(${-dist * lp}px,0,0)`
  }
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

/**
 * Zero-GPU fallback: pre-rendered JPEG frames driven by scroll progress.
 * Used when WebGL is unavailable, on very weak hardware, or ?static=1.
 * All DOM content stays live — only the 3D canvas is replaced.
 */
export default function FrameFallback() {
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
    }
    const onScroll = (): void => {
      if (!queued) {
        queued = true
        raf = requestAnimationFrame(update)
      }
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
    window.addEventListener('resize', onScroll)
    document.getElementById('loader')?.classList.add('done')
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
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
  )
}
