import * as THREE from 'three'
import type { Assembly } from '../assembly'
import type { QualityConfig } from '../config'
import type { FrameCtx, SceneModule } from '../modules'
import type { Stage } from '../stage'
import { bus } from '../../fx/bus'
import { damp, easeInOutCubic, smoothstep } from './math'
import type { LookShared } from './shared'

const PTR_YAW = 0.35 // pointer x → studio yaw (highlight slides facet to facet)
const PTR_PITCH = 0.12 // pointer y → tilt about the camera's right axis
const PTR_LAMBDA = 3 // the light follows a touch slower than the object
const SCROLL_SWEEP = 0.55 // Hero → Detail: highlight moves off the left facet onto the front one
const STREAK = 0.6
const STREAK_DUR = 0.4
const STREAK_RELAX = 0.75 // slow return to the tuned studio orientation
const REASSEMBLED_AT = 0.545 // p where the shells are solid again

/** Scroll-driven base yaw: up through Hero→Detail, home again for Exploded. */
const baseYaw = (p: number): number =>
  SCROLL_SWEEP * smoothstep(0.004, 0.1, p) * (1 - smoothstep(0.135, 0.23, p))

/**
 * Studio light sweeps. Rotates `scene.environmentRotation` and the
 * directional `stage.lightRig` together (same quaternion), so HDRI
 * reflections and key/rim specular stay coherent while they move:
 *   - pointer x/y slides the highlights across the hex facets,
 *   - scroll sweeps the studio through Hero → Detail,
 *   - a fast streak "seals" the object when reassembly completes,
 *   - `streak()` (or `bus.emit('look:streak', {})`) for anyone else — the
 *     lineup ring calls it for the Limited crescendo.
 * Reduced motion: static studio (rotation 0), no streaks.
 */
export class LightSweep implements SceneModule {
  readonly name = 'look:light'
  private stage: Stage | null = null
  private motionOK = true
  private yawPtr = 0
  private pitchPtr = 0
  private streakX = 0
  private streakT = -1
  private streakFrom = 0
  private streakAmt = 0
  private streakDur = STREAK_DUR
  private armed = true
  private lastP = 0
  private forced: number | null = null
  private offs: (() => void)[] = []
  private q = new THREE.Quaternion()
  private qp = new THREE.Quaternion()
  private right = new THREE.Vector3()
  private static readonly Y = new THREE.Vector3(0, 1, 0)

  constructor(private shared: LookShared) {}

  init(stage: Stage, _asm: Assembly, _cfg: QualityConfig): void {
    this.stage = stage
    this.offs.push(
      bus.on('look:streak', (e) => this.streak(e.strength, e.duration)),
    )
  }

  /**
   * Fire a fast studio-light streak across the object (default 0.6 rad in
   * 0.4 s, then a slow relax home). Safe to call any time; no-op when
   * motion is reduced.
   */
  streak(strength = STREAK, duration = STREAK_DUR): void {
    if (!this.motionOK) return
    this.streakFrom = this.streakX
    this.streakAmt = strength
    this.streakDur = Math.max(0.05, duration)
    this.streakT = 0
  }

  /** Debug/lookdev: pin the studio yaw (radians) or release with null. */
  forceYaw(y: number | null): void {
    this.forced = y
  }

  /** Current studio yaw (radians) — e.g. for a DOM highlight that follows. */
  get yaw(): number {
    return this.stage?.lightRig.rotation.y ?? 0
  }

  wantsFrame(): boolean {
    if (this.streakT >= 0 || Math.abs(this.streakX) > 1e-4) return true
    const s = this.shared
    return (
      Math.abs(this.yawPtr - s.px * PTR_YAW) > 1e-4 ||
      Math.abs(this.pitchPtr - s.py * PTR_PITCH) > 1e-4
    )
  }

  onMotionChange(ok: boolean): void {
    this.motionOK = ok
  }

  update(ctx: FrameCtx): void {
    const stage = this.stage
    if (!stage) return
    this.motionOK = ctx.motionOK
    const s = this.shared
    const dt = ctx.dt * s.timeScale

    // reassembly completion → streak (re-armed once you scroll back up)
    if (ctx.p < 0.51) this.armed = true
    if (this.armed && this.lastP < REASSEMBLED_AT && ctx.p >= REASSEMBLED_AT) {
      this.armed = false
      this.streak()
    }
    this.lastP = ctx.p

    let yaw = 0
    let pitch = 0
    if (this.motionOK) {
      this.yawPtr = damp(this.yawPtr, s.px * PTR_YAW, PTR_LAMBDA, dt)
      this.pitchPtr = damp(this.pitchPtr, s.py * PTR_PITCH, PTR_LAMBDA, dt)
      if (this.streakT >= 0) {
        this.streakT += dt
        const k = Math.min(1, this.streakT / this.streakDur)
        this.streakX = this.streakFrom + this.streakAmt * easeInOutCubic(k)
        if (k >= 1) this.streakT = -1
      } else {
        this.streakX = damp(this.streakX, 0, STREAK_RELAX, dt)
        if (Math.abs(this.streakX) < 1e-4) this.streakX = 0
      }
      const breath = s.breath * 0.03 * Math.sin(ctx.time * Math.PI * 2 * 0.07)
      yaw = baseYaw(ctx.p) + this.yawPtr + this.streakX + breath
      pitch = this.pitchPtr
    } else {
      this.yawPtr = this.pitchPtr = this.streakX = 0
      this.streakT = -1
    }
    if (this.forced !== null) yaw = this.forced

    // q = pitch about the camera's right axis · yaw about world up
    this.right.set(1, 0, 0).applyQuaternion(stage.camera.quaternion)
    this.q.setFromAxisAngle(LightSweep.Y, yaw)
    if (pitch !== 0) {
      this.qp.setFromAxisAngle(this.right, pitch)
      this.q.premultiply(this.qp)
    }
    stage.lightRig.quaternion.copy(this.q)
    stage.scene.environmentRotation.setFromQuaternion(this.q)
  }

  dispose(): void {
    this.offs.forEach((f) => f())
    this.offs = []
  }
}
