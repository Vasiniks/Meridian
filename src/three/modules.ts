import type { Assembly } from './assembly'
import type { QualityConfig } from './config'
import type { Stage } from './stage'

/** Per-frame state handed to every scene module. */
export interface FrameCtx {
  /** smoothed scroll progress 0..1 (what the choreography uses) */
  p: number
  /** raw scroll progress 0..1 (where the page actually is) */
  rawP: number
  /** smoothed scroll velocity in progress-units per second (signed) */
  scrollVel: number
  /** clamped frame delta, seconds */
  dt: number
  /** seconds since the experience started */
  time: number
  stage: Stage
  asm: Assembly
  cfg: QualityConfig
  motionOK: boolean
  /** viewport width / height */
  aspect: number
}

/**
 * A pluggable piece of the 3D experience (pointer parallax, post FX, the
 * lineup ring, callouts...). Register with `PencilExperience.addModule()`
 * before or after `init()`; modules added late are initialised on add.
 *
 * Frame order:
 *   preUpdate(ctx)  — before the built-in camera/attitude/parts code. Undo
 *                     any transient offsets you applied last frame here
 *                     (the built-in code integrates some transforms, e.g.
 *                     `asm.group.rotation`, so offsets left in place drift).
 *   [built-in choreography]
 *   update(ctx)     — after it, right before `composer.render()`. Apply
 *                     offsets, drive uniforms, sync DOM overlays.
 */
export interface SceneModule {
  readonly name: string
  init?(stage: Stage, asm: Assembly, cfg: QualityConfig): void | Promise<void>
  preUpdate?(ctx: FrameCtx): void
  update?(ctx: FrameCtx): void
  /** Return true to keep the loop rendering while scroll is settled. */
  wantsFrame?(): boolean
  onResize?(w: number, h: number): void
  /** Reduced-motion / motion-toggle changes. */
  onMotionChange?(ok: boolean): void
  dispose?(): void
}
