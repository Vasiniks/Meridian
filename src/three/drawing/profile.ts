import * as THREE from 'three'
import type { DrawingState } from './state'

/** Side elevation of the assembled pencil, sliced from the real meshes. */
export interface Profile {
  /** closed outline, flat [z, y, z, y, ...] in the pencil frame (local units) */
  pts: Float32Array
  count: number
  yTop: number
  yBot: number
  /** lowest point of the lead sleeve (overall length ends here) */
  ySleeve: number
  zMin: number
  zMax: number
}

const EXTRA = new Set(['leadSleeve', 'lead'])
const BINS = 220

/**
 * Slices every exterior triangle with horizontal planes (one per bin) and
 * keeps the min/max z per slice → the silhouette seen from +X. Runs once
 * after load (rest pose), so it follows whatever geometry the model has.
 */
export function buildProfile(st: DrawingState): Profile | null {
  const ext = st.nodes.filter((n) => n.entry.kind === 'shell' || EXTRA.has(n.entry.name))
  if (ext.length === 0) return null
  const parent = ext[0].node.parent
  if (!parent) return null
  parent.updateWorldMatrix(true, true)
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert()
  const m = new THREE.Matrix4()
  const v = new THREE.Vector3()
  // transform all exterior vertices into the pencil frame
  const tris: Float32Array[] = []
  let yTop = -Infinity
  let yBot = Infinity
  let ySleeve = Infinity
  for (const info of ext) {
    for (const mesh of info.meshes) {
      const g = mesh.geometry
      const pos = g.getAttribute('position')
      if (!pos) continue
      m.multiplyMatrices(inv, mesh.matrixWorld)
      const idx = g.getIndex()
      const n = idx ? idx.count : pos.count
      const out = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const k = idx ? idx.getX(i) : i
        v.fromBufferAttribute(pos, k).applyMatrix4(m)
        out[i * 3] = v.x
        out[i * 3 + 1] = v.y
        out[i * 3 + 2] = v.z
        if (v.y > yTop) yTop = v.y
        if (v.y < yBot) yBot = v.y
        if (info.entry.name === 'leadSleeve' && v.y < ySleeve) ySleeve = v.y
      }
      tris.push(out)
    }
  }
  if (!Number.isFinite(yTop) || yTop - yBot < 1e-3) return null
  if (!Number.isFinite(ySleeve)) ySleeve = yBot
  const span = yTop - yBot
  const zMax = new Float32Array(BINS).fill(-Infinity)
  const zMin = new Float32Array(BINS).fill(Infinity)
  const yc = (b: number): number => yBot + ((b + 0.5) / BINS) * span
  const cut = (ax: number, ay: number, bx: number, by: number, y: number, b: number): void => {
    if ((ay - y) * (by - y) > 0 || ay === by) return
    const z = ax + ((y - ay) / (by - ay)) * (bx - ax)
    if (z > zMax[b]) zMax[b] = z
    if (z < zMin[b]) zMin[b] = z
  }
  for (const t of tris) {
    for (let i = 0; i + 8 < t.length; i += 9) {
      const ay = t[i + 1], az = t[i + 2]
      const by = t[i + 4], bz = t[i + 5]
      const cy = t[i + 7], cz = t[i + 8]
      const lo = Math.min(ay, by, cy)
      const hi = Math.max(ay, by, cy)
      const b0 = Math.max(0, Math.floor(((lo - yBot) / span) * BINS - 0.5))
      const b1 = Math.min(BINS - 1, Math.ceil(((hi - yBot) / span) * BINS - 0.5))
      for (let b = b0; b <= b1; b++) {
        const y = yc(b)
        if (y < lo || y > hi) continue
        cut(az, ay, bz, by, y, b)
        cut(bz, by, cz, cy, y, b)
        cut(cz, cy, az, ay, y, b)
      }
    }
  }
  // fill empty slices from neighbours
  for (let b = 0; b < BINS; b++) {
    if (Number.isFinite(zMax[b])) continue
    const s = b > 0 && Number.isFinite(zMax[b - 1]) ? b - 1 : b + 1 < BINS ? b + 1 : b
    zMax[b] = Number.isFinite(zMax[s]) ? zMax[s] : 0
    zMin[b] = Number.isFinite(zMin[s]) ? zMin[s] : 0
  }
  // outline: right side top → bottom, left side bottom → top (stepped)
  const pts: number[] = []
  const push = (z: number, y: number): void => {
    const n = pts.length
    if (n >= 4) {
      // drop collinear vertical/horizontal runs
      const z1 = pts[n - 2], y1 = pts[n - 1], z0 = pts[n - 4], y0 = pts[n - 3]
      if ((Math.abs(z0 - z1) < 1e-4 && Math.abs(z1 - z) < 1e-4) || (Math.abs(y0 - y1) < 1e-4 && Math.abs(y1 - y) < 1e-4)) {
        pts[n - 2] = z
        pts[n - 1] = y
        return
      }
    }
    pts.push(z, y)
  }
  let zMaxAll = -Infinity
  let zMinAll = Infinity
  const q = (z: number): number => Math.round(z * 250) / 250
  for (let b = BINS - 1; b >= 0; b--) {
    const z = q(zMax[b])
    zMaxAll = Math.max(zMaxAll, z)
    push(z, yBot + ((b + 1) / BINS) * span)
    push(z, yBot + (b / BINS) * span)
  }
  for (let b = 0; b < BINS; b++) {
    const z = q(zMin[b])
    zMinAll = Math.min(zMinAll, z)
    push(z, yBot + (b / BINS) * span)
    push(z, yBot + ((b + 1) / BINS) * span)
  }
  return {
    pts: Float32Array.from(pts),
    count: pts.length,
    yTop,
    yBot,
    ySleeve,
    zMin: zMinAll,
    zMax: zMaxAll,
  }
}
