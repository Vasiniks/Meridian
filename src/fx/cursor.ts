import { bus, type CursorMode } from './bus'
import { addTask, wake } from './ticker'
import { motion } from '../motion/flag'
import { spring, type Spring1 } from '../motion/math'
import { GraphiteTrail } from './graphite'
import { onGeometry, scroll } from './scroll'

/**
 * Custom cursor for fine pointers: a zero-lag graphite nib that draws the
 * trail, plus a spring-follow ring that changes with context.
 *
 * DOM API (pointerover delegation, no per-element listeners):
 *   data-cursor="link|drag|view|part|text|hidden"  [data-cursor-label="…"]
 *   data-no-trail          lift the pencil without changing the cursor
 *   data-magnetic[="0.3"]  magnetic CTA; moves its `.mag` child (face) and
 *                          `.mag-label` grandchild, never the hit area.
 * 3D API: bus.emit('cursor', { mode: 'view', label: 'Select' }) on hover,
 *         bus.emit('cursor', { mode: 'default' }) on leave. DOM states win.
 *
 * Off on touch / coarse pointers, reduced motion and the motion toggle
 * (native cursor restored). Native cursor always shows over text inputs.
 */
const LIFT_SEL =
  'a,button,input,select,textarea,label,summary,[role="button"],[data-cursor],[data-no-trail],[data-magnetic]'
const NATIVE_SEL =
  'input:not([type="radio"]):not([type="checkbox"]):not([type="range"]):not([type="submit"]):not([type="button"]),textarea,select,[contenteditable="true"]'
const LINK_SEL = 'a,button,label,summary,[role="button"],input[type="radio"],input[type="checkbox"],input[type="submit"]'

type Mode = Exclude<CursorMode, 'hover'>

interface Magnet {
  el: HTMLElement
  face: HTMLElement | null
  label: HTMLElement | null
  s: number
  pad: number
  x: Spring1
  y: Spring1
  tx: number
  ty: number
  lastX: number
  lastY: number
  // cached viewport rect (refreshed when scroll or geometry changes)
  l: number
  t: number
  w: number
  h: number
}

export function startCursor(): () => void {
  const root = document.createElement('div')
  root.id = 'cursor'
  root.setAttribute('aria-hidden', 'true')
  root.innerHTML =
    '<div class="cur-ring"><div class="cur-shape"><span class="cur-label"></span></div></div>' +
    '<div class="cur-nib"><div class="cur-dot"></div></div>'
  const ring = root.querySelector<HTMLElement>('.cur-ring')!
  const shape = root.querySelector<HTMLElement>('.cur-shape')!
  const labelEl = root.querySelector<HTMLElement>('.cur-label')!
  const nib = root.querySelector<HTMLElement>('.cur-nib')!
  document.body.append(root)
  // the full-viewport trail canvas is only created once a mouse shows up
  let trailObj: GraphiteTrail | null = null
  const trail = {
    get active(): boolean {
      return !!trailObj && trailObj.active
    },
    frame: (now: number): boolean => (trailObj ? trailObj.frame(now) : false),
    add: (x: number, y: number, t: number, p: boolean): void => trailObj?.add(x, y, t, p),
    lift: (): void => trailObj?.lift(),
    clear: (): void => trailObj?.clear(),
    resize: (): void => trailObj?.resize(),
    ensure: (): void => {
      if (trailObj) return
      trailObj = new GraphiteTrail()
      document.body.insertBefore(trailObj.canvas, root)
    },
  }
  const html = document.documentElement

  // ---- state
  let enabled = false // custom cursor in charge (fine pointer + motion ok + mouse seen)
  let inside = false
  let px = -100
  let py = -100
  let moved = false
  let down = false
  let domMode: Mode | null = null
  let domLabel = ''
  let busMode: Mode | null = null
  let busLabel = ''
  let mode: Mode = 'default'
  let modeLabel = ''
  let lifted = false
  const rx: Spring1 = { x: -100, v: 0 }
  const ry: Spring1 = { x: -100, v: 0 }
  let ringOn = false
  let stuck: Magnet | null = null
  let lastRingX = NaN
  let lastRingY = NaN
  let lastNibX = NaN
  let lastNibY = NaN
  let lastShapeW = -1
  let lastShapeH = -1
  let domLift = false

  // ---- magnets
  let magnets: Magnet[] = []
  const collectMagnets = (): void => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-magnetic]'))
    magnets = els.map((el) => {
      const prev = magnets.find((m) => m.el === el)
      if (prev) return prev
      const face = el.querySelector<HTMLElement>(':scope > .mag') ?? (el.firstElementChild as HTMLElement | null)
      const v = parseFloat(el.dataset.magnetic || '')
      const r = el.getBoundingClientRect()
      return {
        el,
        face,
        label: face?.querySelector<HTMLElement>('.mag-label') ?? null,
        s: Number.isFinite(v) && v > 0 ? v : r.width > 180 ? 0.15 : 0.3,
        pad: r.width > 180 ? 24 : 16,
        x: { x: 0, v: 0 },
        y: { x: 0, v: 0 },
        tx: 0,
        ty: 0,
        lastX: NaN,
        lastY: NaN,
        l: r.left,
        t: r.top,
        w: r.width,
        h: r.height,
      }
    })
    rectSeq = -1
  }
  let rectSeq = -1
  const refreshRects = (): void => {
    if (rectSeq === scroll.seq) return
    rectSeq = scroll.seq
    for (const m of magnets) {
      const r = m.el.getBoundingClientRect()
      m.l = r.left
      m.t = r.top
      m.w = r.width
      m.h = r.height
    }
  }

  // ---- mode resolution
  const applyMode = (): void => {
    let m: Mode = domMode ?? busMode ?? 'default'
    const lbl = domMode ? domLabel : busMode ? busLabel : ''
    if (m === 'link' && lbl) m = 'part' // labelled links read as a pill
    const lift = m !== 'default' || domLift
    if (lift && !lifted) trail.lift()
    lifted = lift
    if (m === mode && lbl === modeLabel) return
    mode = m
    modeLabel = lbl
    root.dataset.mode = m
    if (lbl) labelEl.textContent = lbl
    else if (m === 'drag') labelEl.textContent = 'Drag ⟷'
    else if (m === 'view') labelEl.textContent = 'View'
    else labelEl.textContent = ''
    // pill width follows the label (measured once per change); a stuck
    // ring re-applies the magnet's box on the next frame
    if (m === 'part' || m === 'drag') {
      shape.style.width = `${Math.ceil(labelEl.scrollWidth) + 30}px`
    } else shape.style.removeProperty('width')
    lastShapeW = lastShapeH = -1
    wake()
  }

  const onOver = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return
    const t = e.target as Element | null
    if (!t || !t.closest) return
    const native = t.closest(NATIVE_SEL)
    const tagged = t.closest<HTMLElement>('[data-cursor]')
    domLift = !!t.closest(LIFT_SEL)
    if (native) {
      domMode = 'hidden'
      domLabel = ''
    } else if (tagged) {
      const m = (tagged.dataset.cursor || 'link') as CursorMode
      domMode = m === 'hover' ? 'link' : (m as Mode)
      domLabel = tagged.dataset.cursorLabel || ''
    } else if (t.closest(LINK_SEL)) {
      domMode = 'link'
      domLabel = ''
    } else {
      domMode = null
      domLabel = ''
    }
    applyMode()
  }

  const offBus = bus.on('cursor', ({ mode: m, label }) => {
    busMode = m === 'default' ? null : m === 'hover' ? 'link' : m
    busLabel = label ?? ''
    applyMode()
  })

  // ---- enable / disable
  const setEnabled = (on: boolean): void => {
    if (on === enabled) return
    enabled = on
    html.classList.toggle('has-cursor', on)
    if (!on) {
      trail.clear()
      root.classList.remove('is-on')
      for (const m of magnets) {
        m.x.x = m.x.v = m.y.x = m.y.v = 0
        if (m.face) m.face.style.removeProperty('transform')
        if (m.label) m.label.style.removeProperty('transform')
        m.lastX = m.lastY = NaN
      }
      stuck = null
    }
    wake()
  }
  const allowed = (): boolean => motion.ok && motion.fine

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') {
      setEnabled(false)
      return
    }
    if (!allowed()) return
    px = e.clientX
    py = e.clientY
    if (!enabled) {
      trail.ensure()
      setEnabled(true)
      rx.x = px
      ry.x = py
    }
    if (!inside) {
      inside = true
      root.classList.add('is-on')
    }
    moved = true
    if (!lifted) {
      const evs = e.getCoalescedEvents?.()
      if (evs && evs.length > 1) {
        for (let i = 0; i < evs.length; i++) trail.add(evs[i].clientX, evs[i].clientY, evs[i].timeStamp, down)
      } else trail.add(px, py, e.timeStamp, down)
    }
    wake()
  }
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return
    down = true
    root.classList.add('is-down')
  }
  const onUp = (): void => {
    down = false
    root.classList.remove('is-down')
  }
  const onLeave = (e: PointerEvent): void => {
    if (e.relatedTarget) return
    inside = false
    root.classList.remove('is-on')
    trail.lift()
    stuck = null
    wake()
  }
  const onMotion = (): void => {
    if (!allowed()) setEnabled(false)
  }
  const offMotion = bus.on('motion', onMotion)
  const onResize = (): void => {
    trail.resize()
    wake()
  }

  // ---- frame
  const tick = (dt: number, now: number): boolean => {
    let awake = false
    if (trail.active) awake = trail.frame(now) || awake
    if (!enabled) return awake

    // magnets: find the engaged one (pointer within rect + pad)
    let engaged: Magnet | null = null
    let ecx = 0
    let ecy = 0
    let ew = 0
    let eh = 0
    if (inside && magnets.length) {
      refreshRects()
      let best = 1e9
      for (const m of magnets) {
        if (m.w === 0) continue
        const pad = m.pad
        if (px < m.l - pad || px > m.l + m.w + pad || py < m.t - pad || py > m.t + m.h + pad) continue
        const cx = m.l + m.w / 2
        const cy = m.t + m.h / 2
        const d = Math.abs(px - cx) + Math.abs(py - cy)
        if (d < best) {
          best = d
          engaged = m
          ecx = cx
          ecy = cy
          ew = m.w
          eh = m.h
        }
      }
    }
    for (const m of magnets) {
      if (m === engaged) {
        m.tx = (px - ecx) * m.s
        m.ty = (py - ecy) * m.s
      } else {
        m.tx = 0
        m.ty = 0
      }
      const x = spring(m.x, m.tx, 180, 18, dt)
      const y = spring(m.y, m.ty, 180, 18, dt)
      const live = Math.abs(x - m.tx) > 0.05 || Math.abs(y - m.ty) > 0.05 || Math.abs(m.x.v) > 0.05 || Math.abs(m.y.v) > 0.05
      if (live) awake = true
      else {
        m.x.x = m.tx
        m.y.x = m.ty
        m.x.v = m.y.v = 0
      }
      if (m.face && (Math.abs(m.x.x - m.lastX) > 0.01 || Math.abs(m.y.x - m.lastY) > 0.01 || Number.isNaN(m.lastX))) {
        m.lastX = m.x.x
        m.lastY = m.y.x
        m.face.style.transform = `translate3d(${m.x.x.toFixed(2)}px,${m.y.x.toFixed(2)}px,0)`
        if (m.label) m.label.style.transform = `translate3d(${(m.x.x * 0.6).toFixed(2)}px,${(m.y.x * 0.6).toFixed(2)}px,0)`
      }
    }
    if (engaged !== stuck) {
      stuck = engaged
      root.classList.toggle('is-stuck', !!stuck)
      if (!stuck) {
        lastShapeW = lastShapeH = -1
        shape.style.removeProperty('height')
        if (mode !== 'part' && mode !== 'drag') shape.style.removeProperty('width')
      }
    }
    if (stuck) {
      const sw = Math.round(ew + 14)
      const sh = Math.round(eh + 14)
      if (sw !== lastShapeW || sh !== lastShapeH) {
        lastShapeW = sw
        lastShapeH = sh
        shape.style.width = `${sw}px`
        shape.style.height = `${sh}px`
      }
    }

    // nib: exactly at the pointer
    if (px !== lastNibX || py !== lastNibY) {
      lastNibX = px
      lastNibY = py
      nib.style.transform = `translate3d(${px}px,${py}px,0)`
    }
    // ring: spring-follow (to the magnet's face when stuck)
    const tx = stuck ? ecx + stuck.x.x : px
    const ty = stuck ? ecy + stuck.y.x : py
    const wantRing = mode !== 'default' && mode !== 'hidden'
    if (wantRing !== ringOn) {
      ringOn = wantRing
      if (wantRing) {
        // appear from the nib, not from wherever it was left
        if (!stuck) {
          rx.x = px
          ry.x = py
          rx.v = ry.v = 0
        }
      }
    }
    spring(rx, tx, 320, 30, dt)
    spring(ry, ty, 320, 30, dt)
    if (Math.abs(rx.x - tx) > 0.05 || Math.abs(ry.x - ty) > 0.05 || Math.abs(rx.v) > 0.5 || Math.abs(ry.v) > 0.5) {
      awake = true
    } else {
      rx.x = tx
      ry.x = ty
      rx.v = ry.v = 0
    }
    if (rx.x !== lastRingX || ry.x !== lastRingY) {
      lastRingX = rx.x
      lastRingY = ry.x
      ring.style.transform = `translate3d(${rx.x.toFixed(2)}px,${ry.x.toFixed(2)}px,0)`
    }
    if (moved) {
      moved = false
      awake = true
    }
    return awake
  }

  // reveal fades move CTAs a few px: re-read magnet rects when they settle
  const onTransitionEnd = (e: TransitionEvent): void => {
    if ((e.target as Element).matches?.('[data-reveal]')) rectSeq = -1
  }
  document.addEventListener('transitionend', onTransitionEnd, { passive: true })
  collectMagnets()
  const offGeo = onGeometry(collectMagnets)
  const offIntro = bus.on('intro', collectMagnets)
  const offTask = addTask(tick)
  document.addEventListener('pointerover', onOver, { passive: true })
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown, { passive: true })
  window.addEventListener('pointerup', onUp, { passive: true })
  document.addEventListener('pointerout', onLeave, { passive: true })
  window.addEventListener('resize', onResize)
  return () => {
    offBus()
    offMotion()
    offGeo()
    offIntro()
    offTask()
    setEnabled(false)
    document.removeEventListener('transitionend', onTransitionEnd)
    document.removeEventListener('pointerover', onOver)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointerup', onUp)
    document.removeEventListener('pointerout', onLeave)
    window.removeEventListener('resize', onResize)
    root.remove()
    trailObj?.canvas.remove()
  }
}
