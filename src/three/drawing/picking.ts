import * as THREE from 'three'
import type { DrawingState, NodeInfo } from './state'

/**
 * Cheap pencil picking: rays are tested against each part's node-local
 * bounding box (an oriented box in world space) instead of triangles, so the
 * cost is independent of how detailed the model gets.
 */
export class Picker {
  private rc = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private inv = new THREE.Matrix4()
  private local = new THREE.Ray()
  private hit = new THREE.Vector3()
  /** nearest hit of the last pick */
  node: NodeInfo | null = null
  dist = Infinity

  constructor(private st: DrawingState) {}

  /** Pick at viewport px; returns the group index (-1 = none, -2 = ungrouped part). */
  pick(camera: THREE.Camera, x: number, y: number, skipGroup = -99): number {
    const vp = this.st.vp
    this.ndc.set(((x - vp.left) / vp.w) * 2 - 1, -((y - vp.top) / vp.h) * 2 + 1)
    this.rc.setFromCamera(this.ndc, camera)
    const ray = this.rc.ray
    this.node = null
    this.dist = Infinity
    for (const info of this.st.nodes) {
      if (info.group === skipGroup) continue
      this.inv.copy(info.node.matrixWorld).invert()
      this.local.copy(ray).applyMatrix4(this.inv)
      if (!this.local.intersectBox(info.box, this.hit)) continue
      this.hit.applyMatrix4(info.node.matrixWorld)
      const d = this.hit.distanceTo(ray.origin)
      if (d < this.dist) {
        this.dist = d
        this.node = info
      }
    }
    if (!this.node) return -1
    return this.node.group >= 0 ? this.node.group : -2
  }
}
