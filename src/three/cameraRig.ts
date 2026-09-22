import * as THREE from 'three'
import { KEYS, sstep } from '../data/scroll'

export interface CamSample {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
  label: string
}

/** Interpolates the preserved camera choreography at scroll progress p. */
export function sampleCam(
  p: number,
  mob: number,
  outP: THREE.Vector3,
  outT: THREE.Vector3,
): { fov: number; label: string } {
  let i = 0
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = sstep(a.p, b.p, p)
  outP.set(
    a.pos[0] + (b.pos[0] - a.pos[0]) * t,
    a.pos[1] + (b.pos[1] - a.pos[1]) * t,
    (a.pos[2] + (b.pos[2] - a.pos[2]) * t) * mob,
  )
  outT.set(
    a.tgt[0] + (b.tgt[0] - a.tgt[0]) * t,
    a.tgt[1] + (b.tgt[1] - a.tgt[1]) * t,
    a.tgt[2] + (b.tgt[2] - a.tgt[2]) * t,
  )
  let li = 0
  while (li < KEYS.length - 1 && p > KEYS[li + 1].p) li++
  const dbg = location.search.includes('dbg') ? ` · p=${p.toFixed(3)}` : ''
  return { fov: a.fov + (b.fov - a.fov) * t, label: KEYS[li].label + dbg }
}
