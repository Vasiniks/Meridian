/**
 * Shared pointer state — one listener, read by both the DOM cursor layer and
 * the 3D scene (parallax, hover). Read-only for consumers; call
 * `startPointer()` once at app start.
 */
export interface PointerState {
  /** client pixels */
  x: number
  y: number
  /** normalized device coords, -1..1 (y up) */
  nx: number
  ny: number
  /** pixels per second, raw from the last two events */
  vx: number
  vy: number
  down: boolean
  /** true once the pointer has moved at least once (hide cursor until then) */
  active: boolean
  /** last pointer was touch/pen rather than a mouse */
  coarse: boolean
  /** performance.now() of the last move */
  t: number
}

export const pointer: PointerState = {
  x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
  y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  nx: 0,
  ny: 0,
  vx: 0,
  vy: 0,
  down: false,
  active: false,
  coarse: false,
  t: 0,
}

let started = false

export function startPointer(): () => void {
  if (started) return () => {}
  started = true
  const move = (e: PointerEvent): void => {
    const now = performance.now()
    const dt = Math.max(1, now - pointer.t) / 1000
    if (pointer.active) {
      pointer.vx = (e.clientX - pointer.x) / dt
      pointer.vy = (e.clientY - pointer.y) / dt
    }
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1
    pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1)
    pointer.coarse = e.pointerType !== 'mouse'
    pointer.active = true
    pointer.t = now
  }
  const down = (e: PointerEvent): void => {
    pointer.down = true
    move(e)
  }
  const up = (): void => {
    pointer.down = false
  }
  window.addEventListener('pointermove', move, { passive: true })
  window.addEventListener('pointerdown', down, { passive: true })
  window.addEventListener('pointerup', up, { passive: true })
  window.addEventListener('pointercancel', up, { passive: true })
  return () => {
    started = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerdown', down)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
}
