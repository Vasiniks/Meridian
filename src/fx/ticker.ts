import { MAX_DT } from '../motion/math'

/**
 * The DOM effects layer's single rAF owner.
 *
 * Tasks return `true` while they still need frames; when every task is idle
 * the loop stops. Anything that changes state (pointer move, scroll, a
 * reveal starting) calls `wake()`. dt is clamped to 1/30 s.
 */
export type Tick = (dt: number, now: number) => boolean

const tasks: Tick[] = []
let raf = 0
let running = false
let last = 0

function frame(now: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000))
  last = now
  let awake = false
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i](dt, now)) awake = true
  }
  if (awake) raf = requestAnimationFrame(frame)
  else running = false
}

export function wake(): void {
  if (running) return
  running = true
  last = performance.now()
  raf = requestAnimationFrame(frame)
}

export function addTask(t: Tick): () => void {
  tasks.push(t)
  wake()
  return () => {
    const i = tasks.indexOf(t)
    if (i >= 0) tasks.splice(i, 1)
  }
}

export function stopTicker(): void {
  cancelAnimationFrame(raf)
  running = false
}
