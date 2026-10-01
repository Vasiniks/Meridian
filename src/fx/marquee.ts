import { addTask, wake } from './ticker'
import { motion } from '../motion/flag'
import { bus } from './bus'
import { scroll, onGeometry } from './scroll'

/**
 * Velocity-coupled spec ticker. Markup:
 *   <div data-marquee><div class="mq-track"><span class="mq-copy">…</span>×N</div></div>
 * Base 40 px/s; scroll speed multiplies it (×1 → ×5) and the direction
 * follows the scroll direction. Runs only while on screen and motion is on.
 */
interface Mq {
  el: HTMLElement
  track: HTMLElement
  copyW: number
  x: number
  visible: boolean
  last: number
}

export function startMarquee(): () => void {
  const items: Mq[] = []
  document.querySelectorAll<HTMLElement>('[data-marquee]').forEach((el) => {
    const track = el.querySelector<HTMLElement>('.mq-track')
    if (!track) return
    items.push({ el, track, copyW: 0, x: 0, visible: false, last: NaN })
  })
  if (items.length === 0) return () => {}
  const measure = (): void => {
    for (const m of items) {
      const c = m.track.firstElementChild as HTMLElement | null
      m.copyW = c ? c.getBoundingClientRect().width : 0
    }
  }
  measure()
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const m = items.find((i) => i.el === e.target)
      if (m) m.visible = e.isIntersecting
    }
    wake()
  })
  items.forEach((m) => io.observe(m.el))

  const tick = (dt: number): boolean => {
    if (!motion.ok) return false
    let any = false
    const speed = 40 * (1 + Math.abs(scroll.vs) * 4) * scroll.dir
    for (const m of items) {
      if (!m.visible || m.copyW === 0) continue
      any = true
      m.x -= speed * dt
      if (m.x <= -m.copyW) m.x += m.copyW
      else if (m.x > 0) m.x -= m.copyW
      if (Math.abs(m.x - m.last) > 0.01) {
        m.last = m.x
        m.track.style.transform = `translate3d(${m.x.toFixed(2)}px,0,0)`
      }
    }
    return any
  }
  const offTask = addTask(tick)
  const offGeo = onGeometry(measure)
  const offMotion = bus.on('motion', () => wake())
  void document.fonts.ready.then(measure)
  return () => {
    offTask()
    offGeo()
    offMotion()
    io.disconnect()
  }
}
