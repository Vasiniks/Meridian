import { bus } from './bus'
import { addTask } from './ticker'
import { motion } from '../motion/flag'
import { lockScroll, refreshScroll } from './scroll'
import { clamp, damp, easeInOutCubic, easeOutCubic } from '../motion/math'

/**
 * Preloader — "the drawing becomes the object".
 *
 * An ink elevation of the pencil (dimensioned from the GLB's part table,
 * 1 model unit = 10 mm) drafts itself with stroke-dashoffset, driven by REAL
 * load progress (bus 'load:progress' from experience.init) plus the first
 * rendered frame (`#loader.done`, set by the 3D code / fallbacks). The
 * counter never stalls, the drawing never runs faster than ~1.3 s, then a
 * paper curtain lifts with a drafting straightedge riding its edge and the
 * hero lines reveal (bus 'intro').
 *
 * Repeat visits (sessionStorage) get a short version; reduced motion gets a
 * static drawing and a crossfade.
 */

// ---------------------------------------------------------------- drawing
const NS = 'http://www.w3.org/2000/svg'

interface Stroke {
  el: SVGGeometryElement | SVGElement
  a: number
  b: number
  kind: 'line' | 'fade' | 'clip'
  last: number
}

/** mm → svg units (y up = negative) */
const X = (mm: number): number => mm
const Y = (mm: number): number => -mm

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  parent.appendChild(e)
  return e
}

function buildDrawing(svg: SVGSVGElement): { strokes: Stroke[]; g: SVGGElement } {
  svg.replaceChildren()
  const strokes: Stroke[] = []
  const g = el('g', { class: 'pl-g' }, svg)
  const line = (d: string, a: number, b: number, cls = 'ln'): void => {
    const p = el('path', { d, class: cls, pathLength: 1 }, g)
    strokes.push({ el: p, a, b, kind: 'line', last: -1 })
  }
  const rect = (x0: number, x1: number, r0: number, r1 = r0): string =>
    `M${X(x0)} ${Y(r0)} L${X(x1)} ${Y(r1)} L${X(x1)} ${Y(-r1)} L${X(x0)} ${Y(-r0)} Z`
  const text = (x: number, y: number, s: string, a: number, anchor = 'middle', cls = 'tx'): SVGTextElement => {
    const t = el('text', { x, y, 'text-anchor': anchor, class: cls }, g)
    t.textContent = s
    strokes.push({ el: t, a, b: Math.min(1, a + 0.08), kind: 'fade', last: -1 })
    return t
  }

  // centre-line (dash-dot), revealed by a growing clip rect
  const clip = el('clipPath', { id: 'plCl' }, el('defs', {}, svg))
  const clipRect = el('rect', { x: -14, y: -30, width: 0, height: 60 }, clip)
  el('path', { d: `M-14 0 L${X(156)} 0`, class: 'cl', 'clip-path': 'url(#plCl)' }, g)
  strokes.push({ el: clipRect, a: 0.0, b: 0.32, kind: 'clip', last: -1 })

  // parts, tip → button: [x0, x1, r0, r1?, hex?]
  type Part = [number, number, number, number?, boolean?]
  const parts: Part[] = [
    [-4, 0, 0.25], // 0.5 lead
    [0, 10, 0.5], // lead sleeve
    [9, 12.4, 0.8], // nose tip
    [12.4, 26.6, 1.15, 4.2], // faceted nose (taper)
    [26.6, 28.6, 4.65], // grip ring
    [28.6, 54.8, 4.5, 4.5, true], // grip (hex, lattice)
    [54.8, 57, 4.65], // grip ring
    [57, 118.6, 4.5, 4.5, true], // barrel (hex)
    [119, 125, 4.4], // top collar
    [125, 130.8, 2.2], // eraser sleeve
    [130.8, 142, 3.3, 3.3, true], // button (hex)
  ]
  const n = parts.length
  parts.forEach((pt, i) => {
    const [x0, x1, r0, r1 = r0] = pt
    const a = 0.06 + (i / n) * 0.5
    line(rect(x0, x1, r0, r1), a, a + 0.16)
  })
  // hex facet edges (front flat at ±R/2)
  parts.forEach((pt, i) => {
    if (!pt[4]) return
    const [x0, x1, r0] = pt
    const a = 0.3 + (i / n) * 0.3
    line(`M${X(x0)} ${Y(r0 / 2)} L${X(x1)} ${Y(r0 / 2)}`, a, a + 0.14, 'ln thin')
    line(`M${X(x0)} ${Y(-r0 / 2)} L${X(x1)} ${Y(-r0 / 2)}`, a + 0.02, a + 0.16, 'ln thin')
  })
  // barrel grooves + button chamfer
  line(`M${X(109)} ${Y(4.5)} L${X(109)} ${Y(-4.5)}`, 0.52, 0.6, 'ln thin')
  line(`M${X(111.5)} ${Y(4.5)} L${X(111.5)} ${Y(-4.5)}`, 0.53, 0.61, 'ln thin')
  line(`M${X(141.2)} ${Y(3.3)} L${X(142)} ${Y(2.6)} L${X(142)} ${Y(-2.6)} L${X(141.2)} ${Y(-3.3)}`, 0.6, 0.68, 'ln thin')
  // grip lattice: ±60° crisscross hatch, clipped to the grip
  {
    const gx0 = 29.4
    const gx1 = 54
    const r = 4.5 * 0.94
    const step = 2.3
    const k = 1 / Math.tan((60 * Math.PI) / 180) // dx per unit dy
    const clipX = (x0: number, y0: number, x1: number, y1: number): number[] | null => {
      const dx = x1 - x0
      let t0 = 0
      let t1 = 1
      for (const [pp, q] of [
        [-dx, x0 - gx0],
        [dx, gx1 - x0],
      ]) {
        if (pp === 0) {
          if (q < 0) return null
          continue
        }
        const t = q / pp
        if (pp < 0) t0 = Math.max(t0, t)
        else t1 = Math.min(t1, t)
      }
      if (t1 - t0 <= 0) return null
      return [x0 + t0 * dx, y0 + t0 * (y1 - y0), x0 + t1 * dx, y0 + t1 * (y1 - y0)]
    }
    let j = 0
    for (let sx = gx0 - 2 * r * k; sx < gx1 + 2 * r * k; sx += step) {
      for (const dir of [1, -1]) {
        const seg =
          dir > 0 ? clipX(sx, -r, sx + 2 * r * k, r) : clipX(sx + 2 * r * k, -r, sx, r)
        if (!seg) continue
        const [xa, ya, xb, yb] = seg
        if (Math.hypot(xb - xa, yb - ya) < 1.2) continue
        const a = 0.4 + ((j * 7) % 24) * 0.011
        line(`M${xa.toFixed(2)} ${Y(ya).toFixed(2)} L${xb.toFixed(2)} ${Y(yb).toFixed(2)}`, a, a + 0.09, 'ln hatch')
        j++
      }
    }
  }
  // pocket clip
  line(
    `M${X(92.5)} ${Y(4.5)} C${X(93.4)} ${Y(5.5)} ${X(94)} ${Y(5.6)} ${X(95.5)} ${Y(5.6)} L${X(117.4)} ${Y(5.6)} L${X(119.6)} ${Y(5.2)} L${X(119.6)} ${Y(4.4)}`,
    0.56,
    0.7,
  )

  // VIEW A — end view at 2:1: hexagon (pointy top), A/F 8.0
  const cx = 172
  const R = 9
  const hex = Array.from({ length: 6 }, (_, i) => {
    const t = (Math.PI / 3) * i + Math.PI / 2
    return `${(cx + R * Math.cos(t)).toFixed(2)} ${(-R * Math.sin(t)).toFixed(2)}`
  })
  line(`M${hex.join(' L')} Z`, 0.58, 0.76)
  line(
    `M${hex[0]} L${hex[3]}`,
    0.66,
    0.74,
    'ln thin',
  )
  el('path', { d: `M${cx - 13} 0 L${cx + 13} 0 M${cx} ${-13} L${cx} 13`, class: 'cl' }, g)
  strokes.push({ el: g.lastElementChild as SVGElement, a: 0.56, b: 0.66, kind: 'fade', last: -1 })
  // bore Ø0.5 at 2:1
  el('circle', { cx, cy: 0, r: 1.0, class: 'ln thin', pathLength: 1 }, g)
  strokes.push({ el: g.lastElementChild as SVGElement, a: 0.7, b: 0.78, kind: 'line', last: -1 })

  // dimensions
  const af = (R * Math.sqrt(3)) / 2
  line(`M${cx - af} ${-1} L${cx - af} ${16.5} M${cx + af} ${-1} L${cx + af} ${16.5}`, 0.74, 0.82, 'ln thin')
  line(`M${cx - af} 14 L${cx + af} 14`, 0.8, 0.9, 'ln thin')
  const arrow = (x: number, y: number, dir: 1 | -1): string =>
    `M${x} ${y} L${x + dir * 2.2} ${y - 0.65} L${x + dir * 2.2} ${y + 0.65} Z`
  el('path', { d: arrow(cx - af, 14, 1) + arrow(cx + af, 14, -1), class: 'ar' }, g)
  strokes.push({ el: g.lastElementChild as SVGElement, a: 0.88, b: 0.94, kind: 'fade', last: -1 })
  text(cx, 20.4, 'A/F 8.0', 0.9)
  text(cx, -14.5, 'View A  2:1', 0.86, 'middle', 'tx m')

  // overall length L 142.0
  line(`M0 ${0.8} L0 ${17} M142 ${3.9} L142 ${17}`, 0.72, 0.82, 'ln thin')
  line(`M0 14.5 L60 14.5 M82 14.5 L142 14.5`, 0.8, 0.92, 'ln thin')
  el('path', { d: arrow(0, 14.5, 1) + arrow(142, 14.5, -1), class: 'ar' }, g)
  strokes.push({ el: g.lastElementChild as SVGElement, a: 0.9, b: 0.96, kind: 'fade', last: -1 })
  text(71, 15.6, 'L 142.0', 0.92)
  // lead callout with leader + dot terminal
  line(`M-3 0.4 L-8 -8 L-17 -8`, 0.82, 0.9, 'ln thin')
  el('circle', { cx: -3, cy: 0.4, r: 0.45, class: 'dt' }, g)
  strokes.push({ el: g.lastElementChild as SVGElement, a: 0.82, b: 0.86, kind: 'fade', last: -1 })
  text(-17, -9.4, 'Ø 0.5 lead', 0.88, 'start', 'tx m')
  // balloon on the grip
  line(`M41.5 -3.2 L45 -11 L49 -11`, 0.84, 0.92, 'ln thin')
  el('circle', { cx: 51.6, cy: -11, r: 2.6, class: 'ln thin', pathLength: 1 }, g)
  strokes.push({ el: g.lastElementChild as SVGElement, a: 0.88, b: 0.95, kind: 'line', last: -1 })
  text(51.6, -10.1, '7', 0.94, 'middle', 'tx b')
  return { strokes, g }
}

// ---------------------------------------------------------------- controller
export function startPreloader(): () => void {
  const loader = document.getElementById('loader')
  const svg = document.getElementById('plSvg') as SVGSVGElement | null
  const numEl = document.getElementById('plNum')
  const html = document.documentElement
  if (!loader || !svg || loader.classList.contains('pl-gone')) {
    html.classList.remove('pl-on', 'scroll-locked')
    queueMicrotask(() => bus.emit('intro', {}))
    return () => {}
  }
  const short = html.classList.contains('pl-short')
  const reduced = !motion.ok
  const { strokes, g } = buildDrawing(svg)

  // fit the viewBox to the drawing; portrait screens get a vertical sheet
  let portrait = false
  const fit = (): void => {
    portrait = window.innerWidth / window.innerHeight < 0.9
    g.setAttribute('transform', portrait ? 'rotate(-90)' : '')
    const b = g.getBBox()
    const m = 4
    svg.setAttribute('viewBox', `${b.x - m} ${b.y - m} ${b.width + 2 * m} ${b.height + 2 * m}`)
    const r = svg.getBoundingClientRect()
    // user units per CSS px (svg is 'meet' fitted) → 1px hairlines, 10.5px type
    const vbW = b.width + 2 * m
    const vbH = b.height + 2 * m
    const u = Math.max(vbW / Math.max(1, r.width), vbH / Math.max(1, r.height))
    svg.style.setProperty('--u', u.toFixed(4))
  }
  fit()
  window.addEventListener('resize', fit)

  let real = 0
  let ready = loader.classList.contains('done')
  let shown = 0
  let lastNum = -1
  const t0 = performance.now()
  let doneAt = 0
  let phase: 'load' | 'hold' | 'exit' | 'gone' = 'load'
  const MIN_DRAW = reduced ? 0 : short ? 0.5 : 1.35
  const HOLD = short ? 120 : 260

  const offProg = bus.on('load:progress', ({ p }) => {
    real = Math.max(real, p)
  })
  const mo = new MutationObserver(() => {
    if (loader.classList.contains('done')) ready = true
  })
  mo.observe(loader, { attributes: true, attributeFilter: ['class'] })
  const failsafe = window.setTimeout(() => (ready = true), 14000)

  const paint = (k: number, count = k): void => {
    for (const s of strokes) {
      const t = s.b > s.a ? clamp((k - s.a) / (s.b - s.a), 0, 1) : 1
      if (Math.abs(t - s.last) < 0.001) continue
      s.last = t
      if (s.kind === 'line') {
        ;(s.el as SVGElement).style.strokeDashoffset = (1 - easeInOutCubic(t)).toFixed(4)
      } else if (s.kind === 'fade') {
        ;(s.el as SVGElement).style.opacity = easeOutCubic(t).toFixed(3)
      } else {
        s.el.setAttribute('width', (170 * easeInOutCubic(t)).toFixed(2))
      }
    }
    const nnum = Math.round(count * 100)
    if (numEl && nnum !== lastNum) {
      lastNum = nnum
      numEl.textContent = (nnum < 10 ? '00' : nnum < 100 ? '0' : '') + nnum
    }
  }

  const exit = (): void => {
    phase = 'exit'
    lockScroll(false)
    html.classList.remove('scroll-locked')
    refreshScroll()
    loader.setAttribute('aria-hidden', 'true')
    try {
      sessionStorage.setItem('mh:seen', '1')
    } catch {
      /* private mode */
    }
    if (reduced || !motion.ok) {
      loader.classList.add('pl-fade')
      bus.emit('intro', {})
    } else {
      loader.classList.add('pl-exit')
      window.setTimeout(() => bus.emit('intro', {}), short ? 60 : 150)
    }
    window.setTimeout(
      () => {
        phase = 'gone'
        loader.classList.add('pl-gone')
        html.classList.remove('pl-on')
      },
      reduced ? 480 : 1060,
    )
  }

  let lastNow = t0
  const tick = (_dt: number, now: number): boolean => {
    if (phase === 'gone') return false
    if (phase === 'exit') return true
    // real elapsed time (not the ticker's 1/30 s clamp): on slow frames the
    // counter must still keep pace with the clock
    const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000))
    lastNow = now
    const t = (now - t0) / 1000
    if (reduced) {
      shown = ready ? 1 : Math.max(shown, Math.min(0.99, real))
      paint(1, shown)
    } else {
      // never stalls: a slow floor creeps toward 98 while real progress lags
      const floor =
        0.86 * easeOutCubic(Math.min(1, t / 2.2)) + (t > 2.2 ? 0.12 * (1 - Math.exp(-(t - 2.2) / 4)) : 0)
      const target = ready ? 1 : Math.max(real * 0.9, floor)
      const cap = MIN_DRAW > 0 ? easeInOutCubic(Math.min(1, t / MIN_DRAW)) : 1
      const desired = Math.min(cap, target)
      shown = Math.max(shown, damp(shown, desired, ready ? 9 : 5, dt))
      if (ready && cap >= 1 && desired - shown < 0.004) shown = 1
      paint(shown)
    }
    if (phase === 'load' && ready && shown >= 1) {
      phase = 'hold'
      doneAt = now
    }
    if (phase === 'hold' && now - doneAt >= (reduced ? 120 : HOLD)) exit()
    return true
  }

  lockScroll(true)
  paint(reduced ? 1 : 0, 0)
  const offTask = addTask(tick)
  return () => {
    offTask()
    offProg()
    mo.disconnect()
    clearTimeout(failsafe)
    window.removeEventListener('resize', fit)
  }
}
