import { bus } from '../fx/bus'

/**
 * The single `motionOK` flag every DOM effect reads.
 *
 * Source of truth is `body.reduced`, which App's motion toggle (and the 3D
 * experience's setMotionOK) maintain. At boot we mirror the OS
 * `prefers-reduced-motion` preference into that class so static mode (no
 * WebGL) behaves the same. Changes are broadcast as `bus 'motion'`.
 */
export const motion = {
  ok: true,
  /** primary input is a precise hovering pointer (mouse / trackpad) */
  fine: true,
}

let started = false

export function startMotionFlag(): () => void {
  if (started) return () => {}
  started = true
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const mqFine = window.matchMedia('(hover: hover) and (pointer: fine)')
  if (mqReduce.matches) document.body.classList.add('reduced')
  motion.fine = mqFine.matches
  motion.ok = !document.body.classList.contains('reduced')
  document.documentElement.classList.toggle('motion-off', !motion.ok)

  const read = (): void => {
    const ok = !document.body.classList.contains('reduced')
    if (ok === motion.ok) return
    motion.ok = ok
    document.documentElement.classList.toggle('motion-off', !ok)
    bus.emit('motion', { ok })
  }
  const mo = new MutationObserver(read)
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  const onFine = (): void => {
    motion.fine = mqFine.matches
    bus.emit('motion', { ok: motion.ok })
  }
  mqFine.addEventListener('change', onFine)
  return () => {
    started = false
    mo.disconnect()
    mqFine.removeEventListener('change', onFine)
  }
}
