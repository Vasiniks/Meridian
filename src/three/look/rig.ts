import * as THREE from 'three'
import type { Assembly } from '../assembly'
import type { QualityConfig } from '../config'
import type { FrameCtx, SceneModule } from '../modules'
import type { Stage } from '../stage'
import { bus } from '../../fx/bus'
import { pointer } from '../../fx/pointer'
import { detailF, mechF } from '../../data/scroll'
import { clamp, damp, springSettled, springTo, type Spring } from './math'
import { isCoarseDevice, type LookShared } from './shared'

// Tuning (radians / screen fractions). Weight, not wobble.
const TURN_Y = 0.16 // pointer x → turn about the camera's up axis
const TURN_X = 0.1 // pointer y → turn about the camera's right axis
const POINTER_LAMBDA = 4 // heavy object
const PARALLAX_X = 0.0075 // camera shift per unit distance (≈ 12 px)
const PARALLAX_Y = 0.005
const BREATH_YAW = 0.0105 // ±0.6°
const BREATH_PITCH = 0.006
const BREATH_AFTER = 3 // s without input
const BREATH_STOP = 45 // s without input → settle so the loop can sleep
const ROLL = 0.06 // rad at full scroll speed
const LAG = 0.011 // screen-space lag per unit distance at full speed
const VEL_FULL = 4 // viewport-heights / s that counts as "full speed"
const SPRING_K = 55
const SPRING_C = 2 * Math.sqrt(SPRING_K) // critical: no overshoot

/**
 * Pointer rig: the pencil subtly turns toward the hand, the camera shifts a
 * few pixels of parallax, the object breathes when left alone and carries
 * a little inertia from scroll velocity.
 *
 * Composition: a `rig` group is inserted between the scene and `asm.group`.
 * Its matrix is a pure transient — T(pivot + lag) · R · T(−pivot) —
 * recomputed every frame from scratch, so it never integrates into the
 * choreography in experience.ts (which keeps writing `asm.group` as before).
 * The pivot is the pencil origin, sliding to the grip / jaw in the macro
 * shots so the framed subject turns in place. `asm.group.position` stays a
 * world-space value (rig is identity at rest, pivot-preserving otherwise).
 *
 * Public API (via `exp.getModule<PointerRig>('look:rig')`):
 *   rig.group            the rig Object3D (reparent this, not asm.group)
 *   rig.setWeight(w)     0..1 scales pointer turn + breathing; null = auto
 */
export class PointerRig implements SceneModule {
  readonly name = 'look:rig'
  readonly group = new THREE.Group()

  private stage: Stage | null = null
  private asm: Assembly | null = null
  private enabledPointer = false
  private allowBreath = false
  private motionOK = true
  private frozen = false
  private outAt = 0
  private weightOverride: number | null = null
  private lastInput = performance.now()
  private lastPointerT = 0
  private lastRender = 0
  private sv: Spring = { x: 0, v: 0 }
  private tx = 0
  private ty = 0
  private offs: (() => void)[] = []

  // scratch (no per-frame allocations)
  private qa = new THREE.Quaternion()
  private qb = new THREE.Quaternion()
  private right = new THREE.Vector3()
  private up = new THREE.Vector3()
  private fwd = new THREE.Vector3()
  private pivot = new THREE.Vector3()
  private v = new THREE.Vector3()
  private m = new THREE.Matrix4()
  private inv = new THREE.Matrix4()

  constructor(private shared: LookShared) {
    this.group.name = 'LookRig'
    this.group.matrixAutoUpdate = false
  }

  init(stage: Stage, asm: Assembly, cfg: QualityConfig): void {
    this.stage = stage
    this.asm = asm
    const parent = asm.group.parent ?? stage.scene
    parent.add(this.group)
    this.group.add(asm.group)
    const coarse = isCoarseDevice()
    this.enabledPointer = !coarse
    // Breathing keeps the loop at ~30 fps while idle: desktop only.
    this.allowBreath = !coarse && cfg.quality === 'high'
    this.refreshScroll()
    this.offs.push(
      bus.on('cursor', (e) => {
        this.frozen = e.mode === 'drag'
      }),
    )
    const leave = (): void => {
      this.outAt = performance.now()
    }
    document.documentElement.addEventListener('mouseleave', leave)
    window.addEventListener('blur', leave)
    this.offs.push(() => {
      document.documentElement.removeEventListener('mouseleave', leave)
      window.removeEventListener('blur', leave)
    })
  }

  /** 0..1 multiplier for the pointer turn + breathing; null → automatic. */
  setWeight(w: number | null): void {
    this.weightOverride = w === null ? null : clamp(w, 0, 1)
  }

  private refreshScroll(): void {
    this.shared.maxScroll = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight,
    )
  }

  onResize(): void {
    this.refreshScroll()
  }

  onMotionChange(ok: boolean): void {
    this.motionOK = ok
    if (!ok) {
      this.sv.x = this.sv.v = 0
      this.shared.px = this.shared.py = this.shared.vs = this.shared.breath = 0
      this.group.matrix.identity()
      this.group.matrixWorldNeedsUpdate = true
    }
  }

  /** Pointer target, −1..1 (held while a drag owns the cursor). */
  private target(): void {
    if (this.frozen) return
    const live =
      this.motionOK &&
      this.enabledPointer &&
      pointer.active &&
      !pointer.coarse &&
      this.outAt < pointer.t
    this.shared.pointerLive = live
    this.tx = live ? clamp(pointer.nx, -1, 1) : 0
    this.ty = live ? clamp(pointer.ny, -1, 1) : 0
  }

  private breathTarget(now: number): number {
    if (!this.allowBreath || !this.motionOK) return 0
    const idle = (now - this.lastInput) / 1000
    return idle > BREATH_AFTER && idle < BREATH_STOP ? 1 : 0
  }

  wantsFrame(): boolean {
    if (!this.asm) return false
    if (!springSettled(this.sv, 0, 2e-4)) return true
    this.target()
    const s = this.shared
    if (Math.abs(s.px - this.tx) > 3e-4 || Math.abs(s.py - this.ty) > 3e-4) return true
    const now = performance.now()
    if (this.breathTarget(now) > 0 || s.breath > 0.002) {
      // breathing alone: ~30 fps is plenty for a 0.15 Hz drift
      return now - this.lastRender > 31
    }
    return false
  }

  preUpdate(ctx: FrameCtx): void {
    if (ctx.motionOK !== this.motionOK) this.onMotionChange(ctx.motionOK)
    const s = this.shared
    const now = performance.now()
    s.vhps = (ctx.scrollVel * s.maxScroll) / Math.max(1, window.innerHeight)
    if (Math.abs(ctx.scrollVel) > 1e-3 || pointer.t !== this.lastPointerT) {
      this.lastPointerT = pointer.t
      this.lastInput = now
    }
    s.idle = (now - this.lastInput) / 1000
    const vt = this.motionOK ? clamp(s.vhps / VEL_FULL, -1, 1) : 0
    s.vs = springTo(this.sv, vt, SPRING_K, SPRING_C, ctx.dt * s.timeScale)
    if (Math.abs(s.vs) < 1e-5 && Math.abs(this.sv.v) < 1e-4) s.vs = this.sv.x = this.sv.v = 0
  }

  update(ctx: FrameCtx): void {
    const asm = this.asm
    const stage = this.stage
    if (!asm || !stage) return
    const now = performance.now()
    this.lastRender = now
    const s = this.shared
    if (!this.motionOK) return
    if (asm.group.parent !== this.group) return // someone reparented: stay inert
    const dt = ctx.dt * s.timeScale
    const cam = stage.camera

    this.target()
    s.px = damp(s.px, this.tx, POINTER_LAMBDA, dt)
    s.py = damp(s.py, this.ty, POINTER_LAMBDA, dt)
    if (Math.abs(s.px - this.tx) < 1e-4) s.px = this.tx
    if (Math.abs(s.py - this.ty) < 1e-4) s.py = this.ty
    const bt = this.breathTarget(now)
    s.breath = damp(s.breath, bt, bt > s.breath ? 0.7 : 2.5, dt)
    if (s.breath < 1e-3 && bt === 0) s.breath = 0

    // camera basis (quaternion was set by lookAt this frame)
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion)
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    this.fwd.set(0, 0, -1).applyQuaternion(cam.quaternion)

    // pivot: pencil origin, sliding to the macro subject (rig-free coords)
    const pv = this.pivot.copy(asm.group.position)
    const df = detailF(ctx.p)
    const mc = mechF(ctx.p)
    if (df > 0.001 || mc > 0.001) {
      this.inv.copy(this.group.matrix).invert()
      if (df > 0.001 && asm.gripNode) {
        asm.gripNode.getWorldPosition(this.v).applyMatrix4(this.inv)
        pv.lerp(this.v, df)
      }
      if (mc > 0.001 && asm.jawNodes.length > 0) {
        asm.jawNodes[0].getWorldPosition(this.v).applyMatrix4(this.inv)
        pv.lerp(this.v, mc)
      }
    }
    const dist = Math.max(0.5, cam.position.distanceTo(pv))

    const w = this.weightOverride ?? 1
    const t = ctx.time
    const yaw =
      w * (s.px * TURN_Y + s.breath * BREATH_YAW * Math.sin(t * Math.PI * 2 * 0.15))
    const pitch =
      w *
      (-s.py * TURN_X + s.breath * BREATH_PITCH * Math.sin(t * Math.PI * 2 * 0.11 + 1.3))
    const roll = s.vs * ROLL
    const lag = s.vs * LAG * dist

    // R = yaw(camUp) · pitch(camRight) · roll(camFwd), about the pivot
    this.qa.setFromAxisAngle(this.up, yaw)
    this.qb.setFromAxisAngle(this.right, pitch)
    this.qa.multiply(this.qb)
    this.qb.setFromAxisAngle(this.fwd, roll)
    this.qa.multiply(this.qb)
    const m = this.m.makeRotationFromQuaternion(this.qa)
    // translation = pivot − lag·up − R·pivot
    this.v.copy(pv).applyMatrix4(m)
    m.elements[12] = pv.x - this.v.x - this.up.x * lag
    m.elements[13] = pv.y - this.v.y - this.up.y * lag
    m.elements[14] = pv.z - this.v.z - this.up.z * lag
    this.group.matrix.copy(m)
    this.group.matrixWorldNeedsUpdate = true

    // Camera parallax: a pure translation in the camera plane (no re-aim),
    // so the object slides a few px against the DOM layer. experience.ts
    // re-copies the camera position every frame — nothing to undo.
    const kx = PARALLAX_X * dist * s.px
    const ky = PARALLAX_Y * dist * s.py
    cam.position.addScaledVector(this.right, kx).addScaledVector(this.up, ky)
  }

  dispose(): void {
    this.offs.forEach((f) => f())
    this.offs = []
  }
}
