import * as THREE from 'three'
import type { Assembly, PartEntry } from '../assembly'
import { PART_GROUPS, type PartGroup } from '../../overlay/drawingCopy'

/**
 * Scroll envelopes owned by the drawing layer (p = smoothed page progress).
 * The X-ray is a scan: a hairline sweeps DOWN the viewport; everything it has
 * passed over (above it) is developed into the x-ray / film-negative view,
 * everything ahead of it is still the solid object on paper. The ink then
 * retracts upward before the Mechanism copy arrives (the 3D stays x-ray for
 * the jaw macro) and a final sweep restores the solid shell on exit.
 */
export const SCAN = {
  inA: 0.285, inB: 0.33, // entry sweep: line top → bottom (x-ray + ink above)
  outA: 0.352, outB: 0.386, // ink retracts upward (3D stays x-ray)
  endA: 0.482, endB: 0.522, // restore sweep: line top → bottom (solid above)
}
export const DETAIL_ON = (p: number): boolean => p > 0.066 && p < 0.142
/** Ø 0.50 lead callout: from the hero→detail move through Detail */
export const TIP_ON = (p: number): boolean => p > 0.035 && p < 0.142
export const REASSEMBLY_ON = (p: number): boolean => p > 0.532 && p < 0.586
/** mechanism step thresholds in p; index 0 = rest, 1..5 = the five moves */
export const MECH_P0 = 0.412
export const MECH_DP = 0.012
export const MECH_END = 0.48
export const mechStepAt = (p: number): number =>
  p < MECH_P0 || p > MECH_END ? 0 : Math.min(5, 1 + Math.floor((p - MECH_P0) / MECH_DP))

/** ease with a linear middle, so the line moves at a steady scan speed */
export const ramp = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t < 0.15 ? (t * t) / 0.3 : t > 0.85 ? 1 - ((1 - t) * (1 - t)) / 0.3 : (t - 0.075) / 0.85
}

/** Per-node bounds in the node's local space (computed once after load). */
export interface NodeInfo {
  entry: PartEntry
  node: THREE.Object3D
  meshes: THREE.Mesh[]
  center: THREE.Vector3
  size: THREE.Vector3
  /** half of the larger horizontal extent (local units) */
  radius: number
  box: THREE.Box3
  group: number // index into PART_GROUPS, -1 if unmapped
}

export interface GroupInfo {
  def: PartGroup
  index: number
  anchor: NodeInfo
  nodes: NodeInfo[]
  meshes: THREE.Mesh[]
}

export interface ViewportInfo {
  w: number
  h: number
  left: number
  top: number
  dpr: number
  small: boolean
}

export type XrayMode = 'off' | 'enter' | 'full' | 'exit' | 'fade'

/** Mutable state shared by the drawing modules (one instance). */
export class DrawingState {
  asm: Assembly | null = null
  nodes: NodeInfo[] = []
  byName = new Map<string, NodeInfo>()
  groups: GroupInfo[] = []
  pencilMeshes: THREE.Mesh[] = []
  vp: ViewportInfo = { w: 1, h: 1, left: 0, top: 0, dpr: 1, small: false }
  motionOK = true
  /** scan line (viewport px) for the 3D cut; NaN when no cut */
  cutY = NaN
  mode: XrayMode = 'off'
  /** ink sheet extent (viewport px); inkBot <= inkTop → no ink */
  inkTop = 0
  inkBot = 0
  /** 0..1 opacity of the ink sheet (crossfade under reduced motion) */
  inkAlpha = 0
  /** 0..1: how much of the x-ray is on (drives internal emissive lift) */
  xr = 0
  /** visible scan hairline (viewport px), NaN when hidden */
  lineY = NaN
  /** hovered / pinned part group (index into groups), -1 = none */
  hover = -1
  pinned = -1
  /** current mechanism step (0 rest, 1..5) */
  step = 0
  /** set by the mechanism module on each pencil click (performance.now) */
  clickAt = -1
  clicks = 0

  build(asm: Assembly): void {
    this.asm = asm
    this.nodes.length = 0
    this.byName.clear()
    this.groups.length = 0
    this.pencilMeshes.length = 0
    const inv = new THREE.Matrix4()
    const m = new THREE.Matrix4()
    const tmp = new THREE.Box3()
    asm.group.updateWorldMatrix(true, true)
    for (const e of asm.parts) {
      const meshes: THREE.Mesh[] = []
      e.node.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
      })
      inv.copy(e.node.matrixWorld).invert()
      const box = new THREE.Box3()
      for (const mesh of meshes) {
        const g = mesh.geometry
        if (!g.boundingBox) g.computeBoundingBox()
        m.multiplyMatrices(inv, mesh.matrixWorld)
        tmp.copy(g.boundingBox!).applyMatrix4(m)
        box.union(tmp)
      }
      if (box.isEmpty()) box.set(new THREE.Vector3(-0.05, -0.05, -0.05), new THREE.Vector3(0.05, 0.05, 0.05))
      const size = box.getSize(new THREE.Vector3())
      const info: NodeInfo = {
        entry: e,
        node: e.node,
        meshes,
        center: box.getCenter(new THREE.Vector3()),
        size,
        radius: Math.max(size.x, size.z) / 2,
        box,
        group: -1,
      }
      this.nodes.push(info)
      this.byName.set(e.name, info)
      this.pencilMeshes.push(...meshes)
    }
    PART_GROUPS.forEach((def, gi) => {
      const nodes = def.nodes.map((n) => this.byName.get(n)).filter((x): x is NodeInfo => !!x)
      if (nodes.length === 0) return
      const anchor = this.byName.get(def.anchor) ?? nodes[0]
      const meshes: THREE.Mesh[] = []
      for (const n of nodes) {
        n.group = this.groups.length
        meshes.push(...n.meshes)
      }
      void gi
      this.groups.push({ def, index: this.groups.length, anchor, nodes, meshes })
    })
  }
}
