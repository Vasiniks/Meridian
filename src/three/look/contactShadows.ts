import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js'
import type { Assembly } from '../assembly'
import type { QualityConfig } from '../config'
import type { FrameCtx, SceneModule } from '../modules'
import type { Stage } from '../stage'
import { detailF, mechF, sstep, xrayF } from '../../data/scroll'
import { clamp } from './math'

/** Layer bit used to pick the casters for the shadow camera. */
export const SHADOW_CASTER_LAYER = 29

const SHADOW_COLOR = 0x3a2e25 // warm umber, never black

interface LayerLook {
  /** blur radius of the tight / wide layers, world units */
  tight: number
  wide: number
  /** layer opacities */
  opTight: number
  opWide: number
  /** fraction of the range (nearest the plane) that feeds the tight layer */
  contact: number
  /** max lateral shear (shadow offset per unit of height) */
  maxShear: number
  /** how strongly the light direction shears the shadow */
  shearK: number
}

const PAPER: LayerLook = {
  tight: 0.07,
  wide: 0.55,
  opTight: 0.34,
  opWide: 0.22,
  contact: 0.45,
  maxShear: 0.3,
  shearK: 0.6,
}
const FLOOR: LayerLook = {
  tight: 0.05,
  wide: 0.4,
  opTight: 0.42,
  opWide: 0.18,
  contact: 0.25,
  maxShear: 0.18,
  shearK: 0.25,
}

/** Light travel direction for the paper shadow, in camera space (right, up,
 * forward): a photographer's key from top-right-front, so the shadow keeps
 * falling down-left of the object in every shot. The light sweep rotates it. */
const PAGE_LIGHT = new THREE.Vector3(-0.32, -0.5, 0.8).normalize()
/** Floor light (world): nearly straight down, a touch from front-right. */
const FLOOR_LIGHT = new THREE.Vector3(-0.2, -1, -0.12).normalize()

const blurMaterial = (shader: {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(shader.uniforms),
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  })

const depthMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    name: 'ContactShadowDepth',
    uniforms: { uRange: { value: 1 }, uContact: { value: 0.3 } },
    vertexShader: /* glsl */ `
      varying float vD;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRange;
      uniform float uContact;
      varying float vD;
      // R: steep near-contact term (tight layer) · A: gentle term (wide layer)
      void main() {
        float k = clamp(1.0 - vD / uRange, 0.0, 1.0);
        float kc = clamp(1.0 - vD / (uRange * uContact), 0.0, 1.0);
        gl_FragColor = vec4(kc * kc, 0.0, 0.0, pow(k, 1.3));
      }`,
    side: THREE.DoubleSide,
  })

const planeMaterial = (tT: THREE.Texture, tW: THREE.Texture): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    name: 'ContactShadowPlane',
    uniforms: {
      tTight: { value: tT },
      tWide: { value: tW },
      uViewProj: { value: new THREE.Matrix4() },
      uColor: { value: new THREE.Color(SHADOW_COLOR) },
      uOpTight: { value: 0.4 },
      uOpWide: { value: 0.18 },
      uWeight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tTight;
      uniform sampler2D tWide;
      uniform mat4 uViewProj;
      uniform vec3 uColor;
      uniform float uOpTight;
      uniform float uOpWide;
      uniform float uWeight;
      varying vec3 vW;
      void main() {
        vec4 c = uViewProj * vec4(vW, 1.0);
        vec2 uv = c.xy * 0.5 + 0.5;
        vec2 e = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(1.0), vec2(0.94), uv);
        float a1 = texture2D(tTight, uv).r * uOpTight;
        float a2 = texture2D(tWide, uv).a * uOpWide;
        float a = (1.0 - (1.0 - a1) * (1.0 - a2)) * e.x * e.y * uWeight;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
  })

/**
 * One contact-shadow receiver: a plane + an orthographic depth camera that
 * sits ON the plane looking toward the casters (three's
 * webgl_shadow_contact, generalised to any plane orientation and sheared
 * by the light direction so the shadow falls away from the key light).
 */
class ShadowLayer {
  readonly mesh: THREE.Mesh
  readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private rtDepth: THREE.WebGLRenderTarget
  private rtTmp: THREE.WebGLRenderTarget
  private rtTight: THREE.WebGLRenderTarget
  private rtWideA: THREE.WebGLRenderTarget
  private rtWideB: THREE.WebGLRenderTarget
  private mat: THREE.ShaderMaterial
  private quad: FullScreenQuad
  private hBlur = blurMaterial(HorizontalBlurShader)
  private vBlur = blurMaterial(VerticalBlurShader)
  private half = 1
  private shear = new THREE.Matrix4()
  weight = 0

  constructor(
    size: number,
    readonly look: LayerLook,
  ) {
    const opts = { depthBuffer: false, generateMipmaps: false }
    this.rtDepth = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true })
    this.rtDepth.texture.generateMipmaps = false
    this.rtTmp = new THREE.WebGLRenderTarget(size, size, opts)
    this.rtTight = new THREE.WebGLRenderTarget(size, size, opts)
    const ws = Math.max(32, size >> 2)
    this.rtWideA = new THREE.WebGLRenderTarget(ws, ws, opts)
    this.rtWideB = new THREE.WebGLRenderTarget(ws, ws, opts)
    this.mat = planeMaterial(this.rtTight.texture, this.rtWideB.texture)
    this.mat.uniforms.uOpTight.value = look.opTight
    this.mat.uniforms.uOpWide.value = look.opWide
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat)
    this.mesh.name = 'ContactShadow'
    this.mesh.matrixAutoUpdate = false
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    this.mesh.visible = false
    this.cam.layers.set(SHADOW_CASTER_LAYER)
    this.quad = new FullScreenQuad(this.hBlur)
  }

  private basisM = new THREE.Matrix4()
  private ny = new THREE.Vector3()
  private nz = new THREE.Vector3()

  /**
   * Place the receiver. o: plane centre · x: in-plane axis · n: plane normal
   * (pointing at the casters) · half: half-size of the square footprint ·
   * range: how far above the plane casters still darken it · light: the
   * direction light travels (world).
   */
  frame(
    o: THREE.Vector3,
    x: THREE.Vector3,
    n: THREE.Vector3,
    half: number,
    range: number,
    light: THREE.Vector3,
    maxShear = this.look.maxShear,
  ): void {
    this.half = half
    // shadow camera: looks along +n, x right, y = x × n
    const y = this.ny.crossVectors(x, n)
    const z = this.nz.copy(n).negate()
    this.basisM.makeBasis(x, y, z).setPosition(o)
    this.cam.matrix.copy(this.basisM)
    this.cam.matrix.decompose(this.cam.position, this.cam.quaternion, this.cam.scale)
    this.cam.updateMatrixWorld(true)
    this.cam.left = this.cam.bottom = -half
    this.cam.right = this.cam.top = half
    this.cam.near = 0
    this.cam.far = range
    this.cam.updateProjectionMatrix()
    // oblique projection along the light: x' = x + sx·d (d = −z_view)
    const ln = -light.dot(n)
    let sx = 0
    let sy = 0
    if (ln > 0.05) {
      sx = (light.dot(x) / ln) * this.look.shearK
      sy = (light.dot(y) / ln) * this.look.shearK
      const m = Math.hypot(sx, sy)
      if (m > maxShear) {
        sx *= maxShear / m
        sy *= maxShear / m
      }
    }
    this.shear.set(1, 0, -sx, 0, 0, 1, -sy, 0, 0, 0, 1, 0, 0, 0, 0, 1)
    this.cam.projectionMatrix.multiply(this.shear)
    this.cam.projectionMatrixInverse.copy(this.cam.projectionMatrix).invert()
    // receiver mesh: same footprint, facing the casters
    const ny = this.ny.crossVectors(n, x) // mesh local y
    this.mesh.matrix.makeBasis(x, ny, n).scale(this.v3.set(half * 2, half * 2, 1))
    this.mesh.matrix.setPosition(o)
    this.mesh.matrixWorldNeedsUpdate = true
    this.mat.uniforms.uViewProj.value.multiplyMatrices(
      this.cam.projectionMatrix,
      this.cam.matrixWorldInverse,
    )
  }
  private v3 = new THREE.Vector3()

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    depth: THREE.ShaderMaterial,
  ): void {
    depth.uniforms.uRange.value = this.cam.far
    depth.uniforms.uContact.value = this.look.contact
    const prevOverride = scene.overrideMaterial
    const prevBg = scene.background
    scene.overrideMaterial = depth
    scene.background = null
    renderer.setRenderTarget(this.rtDepth)
    renderer.clear(true, true, false)
    renderer.render(scene, this.cam)
    scene.overrideMaterial = prevOverride
    scene.background = prevBg
    // texel-space blur radii (9-tap kernel spans ±4 steps)
    const toUv = 1 / (8 * this.half)
    this.blur(renderer, this.rtDepth, this.rtTmp, this.rtTight, this.look.tight * toUv)
    this.blur(renderer, this.rtTight, this.rtTmp, this.rtTight, this.look.tight * toUv * 0.5)
    this.blur(renderer, this.rtDepth, this.rtWideA, this.rtWideB, this.look.wide * toUv)
    this.blur(renderer, this.rtWideB, this.rtWideA, this.rtWideB, this.look.wide * toUv * 0.4)
  }

  private blur(
    renderer: THREE.WebGLRenderer,
    src: THREE.WebGLRenderTarget,
    tmp: THREE.WebGLRenderTarget,
    dst: THREE.WebGLRenderTarget,
    amount: number,
  ): void {
    this.quad.material = this.hBlur
    this.hBlur.uniforms.tDiffuse.value = src.texture
    this.hBlur.uniforms.h.value = amount
    renderer.setRenderTarget(tmp)
    this.quad.render(renderer)
    this.quad.material = this.vBlur
    this.vBlur.uniforms.tDiffuse.value = tmp.texture
    this.vBlur.uniforms.v.value = amount
    renderer.setRenderTarget(dst)
    this.quad.render(renderer)
  }

  dispose(): void {
    for (const rt of [this.rtDepth, this.rtTmp, this.rtTight, this.rtWideA, this.rtWideB]) rt.dispose()
    this.mat.dispose()
    this.hBlur.dispose()
    this.vBlur.dispose()
    this.mesh.geometry.dispose()
    this.quad.dispose()
    this.mesh.removeFromParent()
  }
}

/** Built-in visibility of the paper shadow per chapter (0..1). */
export const paperShadowWeight = (p: number): number => {
  const macro = 1 - 0.55 * detailF(p) - 0.9 * mechF(p)
  const xray = 1 - xrayF(p)
  const lineup = 1 - sstep(0.635, 0.69, p) * (1 - sstep(0.955, 0.995, p))
  return clamp(macro * xray * lineup, 0, 1)
}

/**
 * Contact shadows. Two receivers share one set of casters:
 *
 *  - PAPER (default): a plane perpendicular to the view, just behind the
 *    pencil — the seamless paper backdrop of a product shot. Shadow is
 *    sheared away from the key light (follows the light sweep) and fades
 *    by chapter (`paperShadowWeight`). Reads in every camera, unlike a
 *    floor the pencil never comes near.
 *  - FLOOR (opt-in): a horizontal plane at world y, e.g. under the lineup
 *    ring / buy turntable. `setFloor(y)` turns it on.
 *
 * Rendered into small RTs (512 desktop / 256 low) with a two-layer blur
 * (tight + wide, warm umber), and only re-rendered when a caster, the
 * camera or the key light actually moved. Zero cost while weight is 0.
 *
 * API (`exp.getModule<ContactShadows>('look:shadow')`):
 *   addCaster(obj) / removeCaster(obj)   extra pencils (ring clones)
 *   setWeight(w | null)                  paper weight override (null = auto)
 *   setFloor(y | null, weight = 1)       floor receiver at world y
 *   setFloorWeight(w)                    fade the floor receiver
 *   invalidate()                         force a re-render next frame
 */
export class ContactShadows implements SceneModule {
  readonly name = 'look:shadow'
  private stage: Stage | null = null
  private casters = new Set<THREE.Object3D>()
  private meshes: THREE.Mesh[] = []
  private paper: ShadowLayer | null = null
  private floor: ShadowLayer | null = null
  private floorY: number | null = null
  private floorW = 1
  private override: number | null = null
  private depth = depthMaterial()
  private size = 512
  private p = 0
  private sig = NaN
  private dirty = true
  private scanTick = 0
  private pass: Pass | null = null
  private renders = 0

  private box = new THREE.Box3()
  private tmpBox = new THREE.Box3()
  private v = new THREE.Vector3()
  private o = new THREE.Vector3()
  private x = new THREE.Vector3()
  private n = new THREE.Vector3()
  private light = new THREE.Vector3()
  private right = new THREE.Vector3()
  private up = new THREE.Vector3()
  private fwd = new THREE.Vector3()
  private prevClear = new THREE.Color()

  init(stage: Stage, asm: Assembly, cfg: QualityConfig): void {
    this.stage = stage
    this.size = cfg.quality === 'high' ? 512 : 256
    this.paper = new ShadowLayer(this.size, PAPER)
    stage.scene.add(this.paper.mesh)
    this.addCaster(asm.group)
    // Directional shadows only if a part actually receives them.
    let receives = false
    asm.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.receiveShadow) receives = true
    })
    if (receives && cfg.quality === 'high') stage.key.castShadow = true
    // Runs inside composer.render(), after every module's update().
    const self = this
    class ShadowPrePass extends Pass {
      constructor() {
        super()
        this.needsSwap = false
      }
      render(renderer: THREE.WebGLRenderer): void {
        self.renderShadows(renderer)
      }
    }
    this.pass = new ShadowPrePass()
    stage.composer.insertPass(this.pass, 0)
  }

  addCaster(obj: THREE.Object3D): void {
    this.casters.add(obj)
    this.rescan()
  }

  removeCaster(obj: THREE.Object3D): void {
    if (!this.casters.delete(obj)) return
    obj.traverse((o) => o.layers.disable(SHADOW_CASTER_LAYER))
    this.rescan()
  }

  setWeight(w: number | null): void {
    this.override = w === null ? null : clamp(w, 0, 1)
  }

  setFloor(y: number | null, weight = 1): void {
    this.floorY = y
    this.floorW = clamp(weight, 0, 1)
    if (y !== null && !this.floor && this.stage) {
      this.floor = new ShadowLayer(this.size, FLOOR)
      this.stage.scene.add(this.floor.mesh)
    }
    this.dirty = true
  }

  setFloorWeight(w: number): void {
    this.floorW = clamp(w, 0, 1)
  }

  /** Debug: current weights and how often the shadow maps were redrawn. */
  get stats(): { paper: number; floor: number; renders: number; casters: number } {
    return {
      paper: this.paper?.weight ?? 0,
      floor: this.floor?.weight ?? 0,
      renders: this.renders,
      casters: this.meshes.length,
    }
  }

  invalidate(): void {
    this.dirty = true
    this.rescan()
  }

  private rescan(): void {
    this.meshes.length = 0
    for (const c of this.casters) {
      c.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.layers.enable(SHADOW_CASTER_LAYER)
          this.meshes.push(o as THREE.Mesh)
        }
      })
    }
    this.dirty = true
  }

  update(ctx: FrameCtx): void {
    this.p = ctx.p
  }

  /** Cheap change detector over caster + camera + light transforms. */
  private signature(): number {
    let s = 0
    const ms = this.meshes
    for (let i = 0; i < ms.length; i++) {
      const o = ms[i]
      if (!o.visible) continue
      const e = o.matrixWorld.elements
      s += (i + 1) * (e[12] * 1.31 + e[13] * 1.73 + e[14] * 2.11 + e[0] * 0.7 + e[5] * 0.9 + e[2] * 1.1 + e[9] * 1.3)
    }
    const st = this.stage!
    const c = st.camera.matrixWorld.elements
    s += c[12] * 3.1 + c[13] * 3.7 + c[14] * 4.3 + c[8] * 5.1 + c[9] * 5.3 + c[10] * 5.9
    const q = st.lightRig.quaternion
    s += q.x * 7.1 + q.y * 7.3 + q.z * 7.9
    return s
  }

  private casterBox(): THREE.Box3 {
    const b = this.box.makeEmpty()
    for (const m of this.meshes) {
      if (!m.visible || !m.geometry) continue
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      this.tmpBox.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld)
      b.union(this.tmpBox)
    }
    return b
  }

  private renderShadows(renderer: THREE.WebGLRenderer): void {
    const st = this.stage
    const paper = this.paper
    if (!st || !paper) return
    const wPaper = this.override ?? paperShadowWeight(this.p)
    const wFloor = this.floorY !== null ? this.floorW : 0
    paper.weight = wPaper
    paper.mesh.visible = wPaper > 0.004
    if (this.floor) {
      this.floor.weight = wFloor
      this.floor.mesh.visible = wFloor > 0.004
    }
    ;(paper.mesh.material as THREE.ShaderMaterial).uniforms.uWeight.value = wPaper
    if (this.floor) {
      ;(this.floor.mesh.material as THREE.ShaderMaterial).uniforms.uWeight.value = wFloor
    }
    if (wPaper <= 0.004 && wFloor <= 0.004) return
    if (++this.scanTick % 120 === 0) this.rescan()

    const scene = st.scene
    const cam = st.camera
    scene.updateMatrixWorld()
    cam.updateMatrixWorld()
    const sig = this.signature()
    if (!this.dirty && sig === this.sig) return
    this.sig = sig
    this.dirty = false
    this.renders++
    const box = this.casterBox()
    if (box.isEmpty()) return

    const sweep = st.lightRig.quaternion

    const prevTarget = renderer.getRenderTarget()
    const prevAuto = renderer.shadowMap.autoUpdate
    renderer.getClearColor(this.prevClear)
    const prevAlpha = renderer.getClearAlpha()
    renderer.shadowMap.autoUpdate = false
    renderer.setClearColor(0x000000, 0)

    if (paper.mesh.visible) {
      this.right.setFromMatrixColumn(cam.matrixWorld, 0)
      this.up.setFromMatrixColumn(cam.matrixWorld, 1)
      this.fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate()
      // caster extent in camera space
      let zMin = Infinity
      let zMax = -Infinity
      let xMin = Infinity
      let xMax = -Infinity
      let yMin = Infinity
      let yMax = -Infinity
      for (let i = 0; i < 8; i++) {
        this.v.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(cam.position)
        const z = this.v.dot(this.fwd)
        const x = this.v.dot(this.right)
        const y = this.v.dot(this.up)
        if (z < zMin) zMin = z
        if (z > zMax) zMax = z
        if (x < xMin) xMin = x
        if (x > xMax) xMax = x
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
      }
      const depthExt = Math.max(0.2, zMax - zMin)
      const sizeExt = Math.max(xMax - xMin, yMax - yMin)
      // the paper sits a little behind the farthest point of the object
      const gap = 0.08 * sizeExt + 0.1 * depthExt + 0.1
      const zPlane = zMax + gap
      const range = zPlane - zMin + 0.01
      // footprint: orthographic extent at the plane, + shear & blur margin
      const cx = (xMin + xMax) / 2
      const cy = (yMin + yMax) / 2
      const half = sizeExt / 2 + PAPER.maxShear * range + PAPER.wide * 1.6
      this.o
        .copy(cam.position)
        .addScaledVector(this.fwd, zPlane)
        .addScaledVector(this.right, cx)
        .addScaledVector(this.up, cy)
      this.n.copy(this.fwd).negate()
      this.light
        .set(0, 0, 0)
        .addScaledVector(this.right, PAGE_LIGHT.x)
        .addScaledVector(this.up, PAGE_LIGHT.y)
        .addScaledVector(this.fwd, PAGE_LIGHT.z)
        .applyQuaternion(sweep)
      // the offset never exceeds ~a tenth of the object, so a deep pose
      // (pencil pointing at the camera) can't throw a detached ghost
      const shearCap = Math.min(PAPER.maxShear, (0.16 * sizeExt) / range)
      paper.frame(this.o, this.right, this.n, half, range, this.light, shearCap)
      paper.render(renderer, scene, this.depth)
    }

    if (this.floor && this.floor.mesh.visible && this.floorY !== null) {
      const y0 = this.floorY
      const half =
        Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 +
        FLOOR.wide * 1.6 +
        FLOOR.maxShear * 1.5
      const range = clamp(box.max.y - y0, 0.3, 3.5)
      this.o.set((box.min.x + box.max.x) / 2, y0, (box.min.z + box.max.z) / 2)
      this.x.set(1, 0, 0)
      this.n.set(0, 1, 0)
      this.light.copy(FLOOR_LIGHT).applyQuaternion(sweep)
      this.floor.frame(this.o, this.x, this.n, half, range, this.light)
      this.floor.render(renderer, scene, this.depth)
    }

    renderer.shadowMap.autoUpdate = prevAuto
    renderer.setClearColor(this.prevClear, prevAlpha)
    renderer.setRenderTarget(prevTarget)
  }

  dispose(): void {
    if (this.pass && this.stage) this.stage.composer.removePass(this.pass)
    this.paper?.dispose()
    this.floor?.dispose()
    this.depth.dispose()
  }
}
