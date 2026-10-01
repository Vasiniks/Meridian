import { addTask, wake } from './ticker'
import { bus } from './bus'
import { motion } from '../motion/flag'
import { clamp, smoothstep } from '../motion/math'
import { scroll, onGeometry } from './scroll'
import { setOdometer } from './odometer'

/**
 * Scroll-linked chrome, all from cached geometry (no layout reads per frame):
 * - nav title block "SHEET 0X/09 — NAME" (odometer number + masked name roll)
 * - hairline progress rule with ticks at each chapter start
 * - aria-current on the nav link of the active chapter
 * - hero scroll-cue fade, Philosophy tracking ("tighter tolerances"),
 *   Mechanism step counter.
 */
export const SHEETS: readonly { id: string; name: string }[] = [
  { id: 'hero', name: 'Reveal' },
  { id: 'detail', name: 'Detail' },
  { id: 'exploded', name: 'Exploded' },
  { id: 'xray', name: 'X-Ray' },
  { id: 'mechanism', name: 'Mechanism' },
  { id: 'reassembly', name: 'Reassembly' },
  { id: 'philosophy', name: 'Principles' },
  { id: 'lineup', name: 'Lineup' },
  { id: 'buy', name: 'Order' },
]

const pad2 = (n: number): string => (n < 10 ? '0' : '') + n

export function startChrome(): () => void {
  const nav = document.getElementById('nav')
  const num = document.getElementById('sheetNum')
  const nameBox = document.getElementById('sheetName')
  const fill = document.getElementById('ruleFill')
  const ticksBox = document.getElementById('ruleTicks')
  const cue = document.querySelector<HTMLElement>('#hero .scroll-cue')
  const philH2 = document.querySelector<HTMLElement>('#philosophy h2')
  const mechCount = document.getElementById('mechCount')
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('#nav nav.links a'))

  const tops = new Float64Array(SHEETS.length)
  const ticks: HTMLElement[] = []
  let philTop = 0
  let mechTop = 0
  let mechH = 1
  let active = -1
  let lastFill = -1
  let lastCue = -1
  let lastTrack = -1
  let lastMech = -1
  let scrolled: boolean | null = null
  let seq = -1

  const docTop = (el: Element): number => el.getBoundingClientRect().top + window.scrollY
  const measure = (): void => {
    SHEETS.forEach((s, i) => {
      const el = document.getElementById(s.id)
      tops[i] = el ? docTop(el) : i > 0 ? tops[i - 1] : 0
    })
    if (philH2) philTop = docTop(philH2)
    const mech = document.getElementById('mechanism')
    if (mech) {
      mechTop = docTop(mech)
      mechH = Math.max(1, mech.offsetHeight)
    }
    if (ticksBox) {
      if (ticks.length === 0) {
        SHEETS.forEach(() => {
          const t = document.createElement('i')
          ticksBox.append(t)
          ticks.push(t)
        })
      }
      SHEETS.forEach((_, i) => {
        const p = clamp(tops[i] / scroll.max, 0, 1)
        ticks[i].style.left = `${(p * 100).toFixed(3)}%`
      })
    }
    seq = -1
    wake()
  }

  const setSheet = (i: number): void => {
    if (i === active) return
    const first = active === -1
    active = i
    const s = SHEETS[i]
    if (num) setOdometer(num, pad2(i + 1))
    if (nameBox) {
      const next = document.createElement('span')
      next.className = 'sn'
      next.textContent = s.name
      const prev = nameBox.querySelector('.sn:not(.out)')
      if (first || !motion.ok || !prev) {
        nameBox.replaceChildren(next)
      } else {
        next.classList.add('in')
        prev.classList.add('out')
        nameBox.append(next)
        // next frame: let both transition (old up, new from below)
        requestAnimationFrame(() => next.classList.remove('in'))
        window.setTimeout(() => prev.remove(), 800)
      }
    }
    ticks.forEach((t, k) => t.classList.toggle('on', k <= i))
    for (const a of links) {
      if (a.hash === `#${s.id}`) a.setAttribute('aria-current', 'true')
      else a.removeAttribute('aria-current')
    }
    bus.emit('chapter', { index: i, id: s.id, label: s.name })
  }

  const tick = (): boolean => {
    if (seq === scroll.seq) return false
    seq = scroll.seq
    const y = scroll.y
    const vh = scroll.vh
    // active chapter: last section whose top passed the viewport middle
    const probe = y + vh * 0.5
    let i = 0
    while (i < SHEETS.length - 1 && tops[i + 1] <= probe) i++
    if (y >= scroll.max - 2) i = SHEETS.length - 1
    setSheet(i)
    const p = scroll.p
    if (fill && Math.abs(p - lastFill) > 0.0005) {
      lastFill = p
      fill.style.transform = `scaleX(${p.toFixed(4)})`
    }
    const sc = y > 40
    if (nav && sc !== scrolled) {
      scrolled = sc
      nav.classList.toggle('scrolled', sc)
    }
    if (cue) {
      const o = 1 - smoothstep(0, vh * 0.22, y)
      if (Math.abs(o - lastCue) > 0.004) {
        lastCue = o
        // a var, not inline opacity: the host's own reveal owns `opacity`
        cue.style.setProperty('--cue', o.toFixed(3))
      }
    }
    if (philH2) {
      // tracking tightens from +0.06em to −0.035em as the headline rises
      const sp = motion.ok ? smoothstep(philTop - vh * 0.92, philTop - vh * 0.28, y) : 1
      if (Math.abs(sp - lastTrack) > 0.002) {
        lastTrack = sp
        philH2.style.setProperty('--sp', sp.toFixed(3))
      }
    }
    if (mechCount) {
      const mp = clamp((vh * 0.6 - (mechTop - y)) / mechH, 0, 1)
      const si = Math.min(4, Math.floor(mp * 5))
      if (si !== lastMech) {
        lastMech = si
        setOdometer(mechCount, pad2(si + 1))
      }
    }
    return false
  }

  measure()
  const offGeo = onGeometry(measure)
  const offTask = addTask(tick)
  const offMotion = bus.on('motion', () => {
    lastTrack = -1
    seq = -1
    wake()
  })
  return () => {
    offGeo()
    offTask()
    offMotion()
  }
}
