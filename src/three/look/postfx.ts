import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { Assembly } from '../assembly'
import type { QualityConfig } from '../config'
import type { FrameCtx, SceneModule } from '../modules'
import type { Stage } from '../stage'
import { detailF, mechF } from '../../data/scroll'
import { clamp, damp, smoothstep } from './math'
import type { LookShared } from './shared'

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

/**
 * Macro depth-of-field: a 9-tap separable gaussian whose radius grows with
 * distance from a focus LINE through the subject, perpendicular to the
 * pencil's on-screen axis (a diagonal pencil gets a diagonal focal plane,
 * not a horizontal tilt-shift band). Works on premultiplied RGBA, so the
 * alpha (CSS paper behind the canvas) blurs with the colour.
 */
const DofShader = {
  name: 'LookAxisDof',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStep: { value: new THREE.Vector2(1, 0) }, // texel step × direction
    uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uAxis: { value: new THREE.Vector2(0, 1) }, // unit, aspect-corrected
    uAspect: { value: 1 },
    uBand: { value: 0.15 },
    uRamp: { value: 0.35 },
    uMaxPx: { value: 6 },
    uAmount: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uStep;
    uniform vec2 uFocus;
    uniform vec2 uAxis;
    uniform float uAspect;
    uniform float uBand;
    uniform float uRamp;
    uniform float uMaxPx;
    uniform float uAmount;
    varying vec2 vUv;
    void main() {
      vec2 d = (vUv - uFocus) * vec2(uAspect, 1.0);
      float dist = abs(dot(d, uAxis));
      float k = smoothstep(uBand, uBand + uRamp, dist) * uAmount;
      vec2 s = uStep * (k * uMaxPx * 0.25);
      vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
      sum += (texture2D(tDiffuse, vUv - s) + texture2D(tDiffuse, vUv + s)) * 0.1531;
      sum += (texture2D(tDiffuse, vUv - 2.0 * s) + texture2D(tDiffuse, vUv + 2.0 * s)) * 0.12245;
      sum += (texture2D(tDiffuse, vUv - 3.0 * s) + texture2D(tDiffuse, vUv + 3.0 * s)) * 0.0918;
      sum += (texture2D(tDiffuse, vUv - 4.0 * s) + texture2D(tDiffuse, vUv + 4.0 * s)) * 0.051;
      gl_FragColor = sum;
    }`,
}

/**
 * Radial chromatic aberration, edges only (offset ∝ r³), driven by scroll
 * speed. Runs AFTER the OutputPass (display-referred) so each channel can be
 * composited over the CSS paper exactly and re-encoded with one alpha:
 * a dark pencil edge gets true colour fringes instead of a grey halo.
 */
const CaShader = {
  name: 'LookChromaticAberration',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAmount: { value: 0 },
    uAspect: { value: 1 },
    uPaper: { value: new THREE.Vector3(245 / 255, 243 / 255, 238 / 255) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uAspect;
    uniform vec3 uPaper;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 da = d * vec2(uAspect, 1.0);
      float r2 = dot(da, da) / (0.25 * uAspect * uAspect + 0.25);
      vec2 off = d * r2 * uAmount;
      vec4 cr = texture2D(tDiffuse, vUv - off);
      vec4 cg = texture2D(tDiffuse, vUv);
      vec4 cb = texture2D(tDiffuse, vUv + off);
      float a = max(max(cr.a, cg.a), cb.a);
      vec3 col = vec3(
        cr.r + uPaper.r * (a - cr.a),
        cg.g + uPaper.g * (a - cg.a),
        cb.b + uPaper.b * (a - cb.a));
      gl_FragColor = vec4(col, a);
    }`,
}

const CA_MAX = 0.016 // UV offset at the frame edge at full speed (≈ 6 px @1440)
const CA_DEAD = 0.12 // |vs| below this: no CA (and the pass is skipped)
const DOF_MAX_PX = 5 // CSS px at the frame edge

/**
 * Post FX that read premium on paper: velocity CA and macro DOF.
 * Both are skipped entirely (`enabled = false`) when idle — zero cost at
 * rest. Low quality / touch: neither pass is created. Reduced motion: no CA.
 */
export class PostFx implements SceneModule {
  readonly name = 'look:post'
  private stage: Stage | null = null
  private asm: Assembly | null = null
  private dofH: ShaderPass | null = null
  private dofV: ShaderPass | null = null
  private ca: ShaderPass | null = null
  private caAmt = 0
  private dofAmt = 0
  private w = 1
  private h = 1
  private v = new THREE.Vector3()
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private q = new THREE.Quaternion()

  constructor(private shared: LookShared) {}

  init(stage: Stage, asm: Assembly, cfg: QualityConfig): void {
    this.stage = stage
    this.asm = asm
    if (cfg.quality !== 'high') return
    const composer = stage.composer
    const outIdx = composer.passes.findIndex(
      (p) => (p as unknown as { isOutputPass?: boolean }).isOutputPass,
    )
    const at = outIdx >= 0 ? outIdx : composer.passes.length
    this.dofH = new ShaderPass(DofShader)
    this.dofV = new ShaderPass(DofShader)
    this.dofH.enabled = this.dofV.enabled = false
    composer.insertPass(this.dofH, at)
    composer.insertPass(this.dofV, at + 1)
    this.ca = new ShaderPass(CaShader)
    this.ca.enabled = false
    composer.addPass(this.ca)
    this.onResize(window.innerWidth, window.innerHeight)
  }

  onResize(w: number, h: number): void {
    this.w = w
    this.h = h
    const dpr = this.stage?.renderer.getPixelRatio() ?? 1
    const pw = w * dpr
    const ph = h * dpr
    if (this.dofH) {
      this.dofH.uniforms.uStep.value.set(1 / pw, 0)
      this.dofV!.uniforms.uStep.value.set(0, 1 / ph)
      for (const p of [this.dofH, this.dofV!]) {
        p.uniforms.uAspect.value = w / h
        p.uniforms.uMaxPx.value = DOF_MAX_PX * dpr
      }
    }
    if (this.ca) this.ca.uniforms.uAspect.value = w / h
  }

  /** Currently active effects (debug). */
  get state(): { ca: number; dof: number } {
    return { ca: this.caAmt, dof: this.dofAmt }
  }

  wantsFrame(): boolean {
    return this.caAmt > 1e-4
  }

  update(ctx: FrameCtx): void {
    if (!this.stage || !this.asm || !this.ca || !this.dofH || !this.dofV) return
    const dt = ctx.dt * this.shared.timeScale

    // ---- chromatic aberration from scroll speed (edges only) ----
    const target = ctx.motionOK
      ? CA_MAX * smoothstep(CA_DEAD, 1, Math.abs(this.shared.vs))
      : 0
    this.caAmt = damp(this.caAmt, target, target > this.caAmt ? 14 : 6, dt)
    if (this.caAmt < 1e-4) this.caAmt = 0
    this.ca.enabled = this.caAmt > 1e-4
    this.ca.uniforms.uAmount.value = this.caAmt

    // ---- macro DOF in Detail (grip) and Mechanism (jaw) ----
    const df = detailF(ctx.p)
    const mf = mechF(ctx.p)
    const want = Math.max(df, mf)
    this.dofAmt = want
    const on = want > 0.01
    this.dofH.enabled = this.dofV.enabled = on
    if (!on) return
    const asm = this.asm
    const cam = this.stage.camera
    cam.updateMatrixWorld()
    // focus point: blend of grip and jaw by chapter weight
    const fw = df + mf
    this.v.set(0, 0, 0)
    if (df > 0 && asm.gripNode) {
      asm.gripNode.getWorldPosition(this.a)
      this.v.addScaledVector(this.a, df / fw)
    }
    if (mf > 0 && asm.jawNodes.length > 0) {
      asm.jawNodes[0].getWorldPosition(this.a)
      this.v.addScaledVector(this.a, mf / fw)
    }
    // pencil axis (local +Y) on screen
    asm.group.getWorldQuaternion(this.q)
    this.a.set(0, 0.6, 0).applyQuaternion(this.q).add(this.v)
    this.b.set(0, -0.6, 0).applyQuaternion(this.q).add(this.v)
    this.v.project(cam)
    this.a.project(cam)
    this.b.project(cam)
    const aspect = this.w / Math.max(1, this.h)
    let ax = (this.a.x - this.b.x) * aspect
    let ay = this.a.y - this.b.y
    const len = Math.hypot(ax, ay)
    if (len > 1e-5) {
      ax /= len
      ay /= len
    } else {
      ax = 0
      ay = 1
    }
    const fx = this.v.x * 0.5 + 0.5
    const fy = this.v.y * 0.5 + 0.5
    // macro on the jaw is tighter than the grip study
    const band = (0.17 * df + 0.1 * mf) / fw
    const ramp = (0.4 * df + 0.3 * mf) / fw
    const amount = clamp(smoothstep(0.01, 0.6, want), 0, 1)
    for (const p of [this.dofH, this.dofV]) {
      const u = p.uniforms
      u.uFocus.value.set(fx, fy)
      u.uAxis.value.set(ax, ay)
      u.uBand.value = band
      u.uRamp.value = ramp
      u.uAmount.value = amount
    }
  }

  dispose(): void {
    const c = this.stage?.composer
    for (const p of [this.dofH, this.dofV, this.ca]) {
      if (!p) continue
      c?.removePass(p)
      p.dispose()
    }
  }
}
