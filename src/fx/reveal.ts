import { bus } from './bus'
import { addTask, wake } from './ticker'
import { motion } from '../motion/flag'
import { clamp, easeOutCubic } from '../motion/math'
import { prepareOdometer, rollOdometer } from './odometer'

/**
 * Attribute-driven reveals. Opt in from any component:
 *
 *   data-reveal="lines"  headline rises line by line out of hairline masks
 *                        (1.1 s expo.out, 80 ms stagger). Static text only:
 *                        the host's children are replaced by line spans; the
 *                        host gets aria-label, the splits are aria-hidden.
 *   data-reveal="fade"   body copy: opacity + 12 px lift, 0.9 s.
 *   data-reveal="type"   mono eyebrow types on with a short scramble edge
 *                        (use at most once per section).
 *   data-reveal-delay="ms"   extra delay before the element starts.
 *   data-odometer        digits inside roll into place (odometer columns)
 *                        when revealed; combine with any data-reveal.
 *
 * Nothing reveals before the preloader curtain lifts (`bus 'intro'`).
 * Reduced motion: no splitting, just crossfades.
 */
type Host = HTMLElement & { __rvOrig?: Node[]; __rvW?: number; __rvLabelSet?: boolean }

const SEL = '[data-reveal],[data-odometer]'
let io: IntersectionObserver | null = null
let ro: ResizeObserver | null = null
let introDone = false
let fontsDone = false
const pending = new Set<HTMLElement>()

// ---------------------------------------------------------------- split lines
function wrapWords(
  node: Node,
  chain: Element[],
  out: { el: HTMLElement | null; chain: Element[]; space: boolean }[],
): void {
  const kids = Array.from(node.childNodes)
  for (const child of kids) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child as Text).data
      const parts = text.split(/(\s+)/)
      const frag = document.createDocumentFragment()
      let space = false
      for (const part of parts) {
        if (!part) continue
        if (/^\s+$/.test(part)) {
          frag.append(' ')
          space = true
          continue
        }
        const s = document.createElement('span')
        s.className = 'rw'
        s.textContent = part
        frag.append(s)
        out.push({ el: s, chain, space })
        space = false
      }
      // a trailing space belongs before the next word (possibly in a sibling element)
      if (space) out.push({ el: null, chain, space: true })
      child.replaceWith(frag)
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element
      if (el.tagName === 'BR') {
        out.push({ el: null, chain: [el], space: false })
        continue
      }
      wrapWords(el, chain.concat(el), out)
    }
  }
}

function splitLines(host: Host): void {
  const orig = host.__rvOrig ?? (host.__rvOrig = Array.from(host.childNodes))
  if (!host.hasAttribute('aria-label')) {
    const label = orig
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    host.setAttribute('aria-label', label)
    host.__rvLabelSet = true
  }
  // measure on a fresh deep clone; the original (React-owned) nodes stay intact
  host.replaceChildren(...orig.map((n) => n.cloneNode(true)))
  const words: { el: HTMLElement | null; chain: Element[]; space: boolean }[] = []
  wrapWords(host, [], words)

  const fs = parseFloat(getComputedStyle(host).fontSize) || 16
  type Line = { items: { el: HTMLElement; chain: Element[]; space: boolean }[] }
  const lines: Line[] = []
  let cur: Line | null = null
  let lastMid = -1e9
  let pendingSpace = false
  for (const w of words) {
    if (!w.el) {
      if (w.chain[0]?.tagName === 'BR') {
        cur = null
        lastMid = -1e9
        pendingSpace = false
      } else if (w.space) pendingSpace = true
      continue
    }
    const r = w.el.getBoundingClientRect()
    const mid = r.top + r.height / 2
    if (!cur || mid - lastMid > fs * 0.55) {
      cur = { items: [] }
      lines.push(cur)
      lastMid = mid
      pendingSpace = false
    }
    cur.items.push({ el: w.el, chain: w.chain, space: (w.space || pendingSpace) && cur.items.length > 0 })
    pendingSpace = false
  }

  const out: HTMLElement[] = []
  lines.forEach((line, i) => {
    const rl = document.createElement('span')
    rl.className = 'rl'
    rl.setAttribute('aria-hidden', 'true')
    const rli = document.createElement('span')
    rli.className = 'rli'
    rli.style.setProperty('--i', String(i))
    rl.append(rli)
    const open: Element[] = []
    const openSrc: Element[] = []
    for (const it of line.items) {
      let k = 0
      while (k < openSrc.length && k < it.chain.length && openSrc[k] === it.chain[k]) k++
      open.length = k
      openSrc.length = k
      const container = (): Element => (open.length ? open[open.length - 1] : rli)
      if (it.space) container().append(' ')
      for (let j = k; j < it.chain.length; j++) {
        const c = it.chain[j].cloneNode(false) as Element
        container().append(c)
        open.push(c)
        openSrc.push(it.chain[j])
      }
      container().append(it.el.textContent ?? '')
    }
    out.push(rl)
  })
  host.replaceChildren(...out)
  host.style.setProperty('--n', String(lines.length))
  host.classList.add('rv-split')
  host.__rvW = host.clientWidth
}

function unsplit(host: Host): void {
  if (!host.__rvOrig) return
  host.replaceChildren(...host.__rvOrig)
  host.classList.remove('rv-split')
  if (host.__rvLabelSet) host.removeAttribute('aria-label')
  host.__rvOrig = undefined
}

// ---------------------------------------------------------------- type-on
const GLYPHS = 'ABCDEFGHJKLMNPRSTUVXYZ0123456789/+-·'
interface TypeAnim {
  a: HTMLElement
  b: HTMLElement
  c: HTMLElement
  text: string
  t0: number
  dur: number
}
const typing: TypeAnim[] = []

function prepareType(host: HTMLElement): void {
  if (host.dataset.rvType) return
  const text = (host.textContent ?? '').replace(/\s+/g, ' ').trim()
  host.dataset.rvType = '1'
  const sr = document.createElement('span')
  sr.className = 'sr-only'
  sr.textContent = text
  const vis = document.createElement('span')
  vis.className = 'ty'
  vis.setAttribute('aria-hidden', 'true')
  const a = document.createElement('span')
  const b = document.createElement('span')
  b.className = 'ty-edge'
  const c = document.createElement('span')
  c.className = 'ty-rest'
  c.textContent = text
  vis.append(a, b, c)
  host.replaceChildren(sr, vis)
}

function startType(host: HTMLElement): void {
  const vis = host.querySelector('.ty')
  if (!vis) return
  const [a, b, c] = Array.from(vis.children) as HTMLElement[]
  const text = host.querySelector('.sr-only')?.textContent ?? ''
  if (!motion.ok) {
    a.textContent = text
    b.textContent = ''
    c.textContent = ''
    return
  }
  const delay = Number(host.dataset.revealDelay || 0)
  typing.push({ a, b, c, text, t0: performance.now() + delay, dur: clamp(text.length * 26, 420, 980) })
  wake()
}

function tickType(_dt: number, now: number): boolean {
  if (typing.length === 0) return false
  for (let i = typing.length - 1; i >= 0; i--) {
    const t = typing[i]
    const k = (now - t.t0) / t.dur
    if (k < 0) continue
    const n = t.text.length
    if (k >= 1) {
      t.a.textContent = t.text
      t.b.textContent = ''
      t.c.textContent = ''
      typing.splice(i, 1)
      continue
    }
    const head = Math.floor(easeOutCubic(k) * n)
    const edge = Math.min(n, head + 3)
    let scr = ''
    for (let j = head; j < edge; j++) {
      const ch = t.text[j]
      scr += ch === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]
    }
    t.a.textContent = t.text.slice(0, head)
    t.b.textContent = scr
    t.c.textContent = t.text.slice(edge)
  }
  return true
}

// ---------------------------------------------------------------- reveal
function reveal(el: HTMLElement): void {
  if (el.classList.contains('is-in')) return
  const delay = el.dataset.revealDelay
  if (delay) el.style.setProperty('--rd', `${delay}ms`)
  el.classList.add('is-in')
  if (el.dataset.reveal === 'type') startType(el)
  if (el.hasAttribute('data-odometer')) rollOdometer(el, Number(delay || 0))
  el.querySelectorAll<HTMLElement>('[data-odometer]').forEach((o) =>
    rollOdometer(o, Number(o.dataset.revealDelay || delay || 0)),
  )
}

function prepare(el: HTMLElement): void {
  if (el.dataset.rvPrep) return
  el.dataset.rvPrep = '1'
  const kind = el.dataset.reveal
  if (kind === 'lines' && motion.ok) {
    splitLines(el as Host)
    ro?.observe(el)
  } else if (kind === 'type') prepareType(el)
  if (el.hasAttribute('data-odometer')) prepareOdometer(el)
}

/** Scan for (new) reveal hosts; safe to call any time after mount. */
export function scanReveals(root: ParentNode = document): void {
  if (!fontsDone) return
  root.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
    prepare(el)
    if (el.classList.contains('is-in')) return
    // odometers nested in a reveal host roll with their host
    if (!el.dataset.reveal && el.parentElement?.closest('[data-reveal]')) return
    if (introDone) schedule(el)
    else pending.add(el)
  })
}

/**
 * Already on screen → reveal now; otherwise wait for the observer (its -10%
 * root margin is for content arriving from below while scrolling).
 */
function schedule(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  if (r.top < window.innerHeight && r.bottom > 0 && r.width > 0) reveal(el)
  else io?.observe(el)
}

/** Reveal an element now (e.g. a component that controls its own timing). */
export function revealNow(el: HTMLElement): void {
  prepare(el)
  io?.unobserve(el)
  reveal(el)
}

export function startReveals(): () => void {
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        io!.unobserve(e.target)
        reveal(e.target as HTMLElement)
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0 },
  )
  let roTimer = 0
  const dirty = new Set<Host>()
  ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const h = e.target as Host
      if (h.__rvW !== undefined && Math.abs(h.clientWidth - h.__rvW) > 1) dirty.add(h)
    }
    if (dirty.size === 0) return
    clearTimeout(roTimer)
    roTimer = window.setTimeout(() => {
      dirty.forEach((h) => h.__rvOrig && splitLines(h))
      dirty.clear()
    }, 150)
  })
  const offTask = addTask(tickType)

  const fontsReady = Promise.race([
    Promise.all([
      document.fonts.load('500 1em "Hanken Grotesk"'),
      document.fonts.load('600 1em "Hanken Grotesk"'),
      document.fonts.load('italic 400 1em "Newsreader"'),
      document.fonts.load('400 1em "DM Mono"'),
    ]).then(() => document.fonts.ready),
    new Promise((r) => setTimeout(r, 2500)),
  ])
  void fontsReady.then(() => {
    fontsDone = true
    scanReveals()
  })
  // a late font swap changes line breaks: re-split what's already split
  const onFontsDone = (): void => {
    document.querySelectorAll<Host>('.rv-split').forEach((h) => splitLines(h))
  }
  document.fonts.addEventListener('loadingdone', onFontsDone)

  const offIntro = bus.on('intro', () => {
    if (introDone) return
    introDone = true
    scanReveals()
    pending.forEach(schedule)
    pending.clear()
  })
  return () => {
    offIntro()
    offTask()
    io?.disconnect()
    ro?.disconnect()
    document.fonts.removeEventListener('loadingdone', onFontsDone)
    document.querySelectorAll<Host>('.rv-split').forEach(unsplit)
    document.querySelectorAll<HTMLElement>('[data-rv-prep]').forEach((el) => delete el.dataset.rvPrep)
    introDone = false
    fontsDone = false
    pending.clear()
  }
}
