import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Assembly } from './assembly'
import type { QualityConfig } from './config'
import type { FrameCtx, SceneModule } from './modules'
import type { Stage } from './stage'
import { FINISHES, VARIANT_ORDER, isVariantName, type Finish, type VariantName } from './finishes'
import { bus } from '../fx/bus'
import { pointer } from '../fx/pointer'
import {
  LINEUP_COUNT,
  LINEUP_PIN,
  RING_IN,
  RING_MOVES,
  RING_OUT,
  RING_RISE,
  RING_SINK,
  ringIndex,
  ringMoving,
  ringTarget,
  sstep,
} from '../data/scroll'
import {
  detentY,
  gotoBuy,
  gotoDetent,
  lineupTop,
  nav,
  releaseHold,
  scrollToY,
} from '../components/lineupNav'

/**
 * LINEUP RING — the four finishes on a rotary indexing plate.
 *
 * Four clones of the pencil (geometry merged per material once and shared;
 * materials cloned per pencil so each wears its full FINISHES entry) stand
 * upright on a vertical-axis ring. Scroll position is the single source of
 * truth: `ringTarget(u)` maps section-local scroll to a ring position with
 * dwell plateaus, a spring adds mass on top, and every interaction (click,
 * drag, dial, CTA) scrolls the page to a detent instead of owning state.
 *
 * Choreography (u = viewport heights from the moment #lineup pins):
 *   RING_IN    hero pencil (live asm.group) glides into the front slot while
 *              the camera pulls back; at the end it is swapped for the Core
 *              clone at an identical pose and finish (invisible swap)
 *   RING_RISE  the three siblings rise out of the paper fog, staggered
 *   0..PIN     detents: Core → Pro → Studio → Limited
 *   RING_SINK  unselected pencils sink back into the fog
 *   RING_OUT   the presenter (selected variant) flies into the Buy slot
 *              (#buyStage), locked to that DOM box; buy radios chase its
 *              finish there.
 */

const STEP = (Math.PI * 2) / LINEUP_COUNT
/** world-space pencil length on the ring (scene units) */
const PENCIL_LEN = 7
/** ring radius relative to pencil length */
const RADIUS = 2.25
/** tangential lean of each pencil on the ring (rad) */
const LEAN = 0.09
/** camera azimuth off the front axis (rad): separates back from front pencils */
const AZIMUTH = 0.34
const PICK_LAYER = 31
/** QA: `?nosnap` freezes mid-swing positions for inspection */
const NO_SNAP = typeof location !== 'undefined' && location.search.includes('nosnap')

const tmpV = new THREE.Vector3()
const tmpV2 = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpM = new THREE.Matrix4()
const tmpS = new THREE.Vector3()
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Apply a full finish (albedo + roughness + metalness + env) to a material. */
export function applyFinish(mat: THREE.MeshStandardMaterial, f: Finish, envScale = 1): void {
  mat.color.setHex(f.color)
  mat.roughness = f.roughness
  mat.metalness = f.metalness
  mat.envMapIntensity = f.envIntensity * envScale
}

interface FinishState {
  color: THREE.Color
  roughness: number
  metalness: number
  env: number
}

const finishState = (f: Finish): FinishState => ({
  color: new THREE.Color().setHex(f.color),
  roughness: f.roughness,
  metalness: f.metalness,
  env: f.envIntensity,
})

function setFinishState(s: FinishState, f: Finish): void {
  s.color.setHex(f.color)
  s.roughness = f.roughness
  s.metalness = f.metalness
  s.env = f.envIntensity
}

interface Member {
  name: VariantName
  idx: number
  root: THREE.Group
  meshes: THREE.Mesh[]
  mats: THREE.MeshStandardMaterial[]
  baseEnv: number[]
  barrel: THREE.MeshStandardMaterial | null
  proxy: THREE.Mesh
  /** angle on the ring (0 = front), focus weight (1 front … 0 side/back) */
  theta: number
  focus: number
  spin: number
  /** resolved slot pose (ring-parent space) */
  pos: THREE.Vector3
  quat: THREE.Quaternion
  scale: number
  visible: boolean
  envK: number
}

// ---------------------------------------------------------------- tone maps
// The canvas is transparent over CSS paper, so "fade into the paper" means
// fogging toward the LINEAR colour that the OutputPass tone-maps back to
// #F5F3EE. Invert whatever tone mapping the renderer uses (numerically).
function neutralTM(c: number[], exposure: number): number[] {
  const sc = 0.8 - 0.04
  const desat = 0.15
  let r = c[0] * exposure
  let g = c[1] * exposure
  let b = c[2] * exposure
  const x = Math.min(r, g, b)
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04
  r -= off
  g -= off
  b -= off
  const peak = Math.max(r, g, b)
  if (peak < sc) return [r, g, b]
  const d = 1 - sc
  const np = 1 - (d * d) / (peak + d - sc)
  const k = np / peak
  r *= k
  g *= k
  b *= k
  const gg = 1 - 1 / (desat * (peak - np) + 1)
  return [r + (np - r) * gg, g + (np - g) * gg, b + (np - b) * gg]
}

function acesTM(c: number[], exposure: number): number[] {
  // three's ACESFilmicToneMapping
  const e = exposure / 0.6
  const v = [c[0] * e, c[1] * e, c[2] * e]
  const i0 = 0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2]
  const i1 = 0.076 * v[0] + 0.90834 * v[1] + 0.01566 * v[2]
  const i2 = 0.0284 * v[0] + 0.13383 * v[1] + 0.83777 * v[2]
  const fit = (x: number): number => {
    const a = x * (x + 0.0245786) - 0.000090537
    const b = x * (0.983729 * x + 0.432951) + 0.238081
    return a / b
  }
  const f0 = fit(i0)
  const f1 = fit(i1)
  const f2 = fit(i2)
  const o0 = 1.60475 * f0 - 0.53108 * f1 - 0.07367 * f2
  const o1 = -0.10208 * f0 + 1.10813 * f1 - 0.00605 * f2
  const o2 = -0.00327 * f0 - 0.07276 * f1 + 1.07602 * f2
  return [Math.min(1, Math.max(0, o0)), Math.min(1, Math.max(0, o1)), Math.min(1, Math.max(0, o2))]
}

function inverseToneMap(target: THREE.Color, renderer: THREE.WebGLRenderer, out: THREE.Color): void {
  const exp = renderer.toneMappingExposure
  const tm =
    renderer.toneMapping === THREE.NeutralToneMapping
      ? neutralTM
      : renderer.toneMapping === THREE.ACESFilmicToneMapping
        ? acesTM
        : renderer.toneMapping === THREE.LinearToneMapping
          ? (c: number[], e: number) => [c[0] * e, c[1] * e, c[2] * e]
          : null
  const t = [target.r, target.g, target.b]
  if (!tm) {
    out.setRGB(t[0], t[1], t[2])
    return
  }
  // Newton with a full numeric Jacobian (channels couple through the
  // peak / desaturation terms, so a per-channel solve diverges)
  const det = (m: number[][]): number =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  let x = t.map((v) => v * 1.2)
  const J = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let it = 0; it < 80; it++) {
    const y = tm(x, exp)
    const r = [t[0] - y[0], t[1] - y[1], t[2] - y[2]]
    if (Math.max(Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2])) < 1e-7) break
    for (let j = 0; j < 3; j++) {
      const h = 1e-5 + x[j] * 1e-4
      const xp = x.slice()
      xp[j] += h
      const yp = tm(xp, exp)
      for (let i = 0; i < 3; i++) J[i][j] = (yp[i] - y[i]) / h
    }
    const D = det(J)
    if (Math.abs(D) < 1e-12) break
    const dx = [0, 1, 2].map((k) => det(J.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / D)
    x = x.map((v, i) => Math.min(64, Math.max(0, v + dx[i])))
  }
  out.setRGB(x[0], x[1], x[2])
}

// ---------------------------------------------------------------- module
export interface RingOptions {
  /** look up sibling modules (e.g. the LOOK layer's light sweep) */
  lookup?: (name: string) => SceneModule | undefined
}

export class RingModule implements SceneModule {
  readonly name = 'ring'
  private opts: RingOptions

  constructor(opts: RingOptions = {}) {
    this.opts = opts
  }

  private stage: Stage | null = null
  private asm: Assembly | null = null
  private parent: THREE.Object3D | null = null
  private root = new THREE.Group()
  private members: Member[] = []
  private geoms: { geometry: THREE.BufferGeometry; matIndex: number; matrix?: THREE.Matrix4 }[] = []
  private ownGeoms: THREE.BufferGeometry[] = []
  private srcMats: THREE.Material[] = []
  private barrelSrcIndex = -1
  private pencilMidY = 0
  private pencilLen0 = 15
  private sBase = 0.46
  private motionOK = true

  // plate (rotary indexing table drawn in hairlines)
  private plate = new THREE.Group()
  private plateSpin = new THREE.Group()
  private plateLines: THREE.LineSegments[] = []
  private plateMats: THREE.LineBasicMaterial[] = []
  private plateCounts: number[] = []
  private indexMark: THREE.Mesh | null = null

  // layout (refreshed on resize / document-height changes)
  private vw = 1
  private vh = 1
  private maxScroll = 1
  private secTop = 0
  private docH = 0
  private haveLayout = false
  private stageBox = { x: 0, y: 0, w: 1, h: 1 }
  private portrait = false
  private camPos = new THREE.Vector3()
  private camTgt = new THREE.Vector3()
  private camFov = 30
  private camUp = new THREE.Vector3(0, 1, 0)
  private camHalfH = 1
  private camPosLive = new THREE.Vector3()
  private camTgtLive = new THREE.Vector3()
  private R = RADIUS
  private lastOutCss = -1
  private frontDist = 12
  private pxPerDetent = 260

  // per-frame state
  private uS = -10
  private uR = -10
  private inW = 0
  private camW = 0
  private outW = 0
  private sinkW = 0
  private rho = 0
  private rhoV = 0
  private frontIdx = 0
  private emittedIdx = 0
  private selected: VariantName = 'Core'
  private presenter = -1
  private chase: FinishState = finishState(FINISHES.Core)
  private chaseTarget: Finish = FINISHES.Core
  private chaseLive = false
  private active = false
  private ringVisible = false
  private lastRingCss = -1
  private lastScrollY = -1
  private lastScrollMoveT = 0
  private snapGuardU = -100
  private fog: THREE.Fog | null = null
  private fogColor = new THREE.Color()
  private fogKey = ''
  private fogNear0 = 1e5
  private fogFar0 = 1e5 + 1
  private paper = new THREE.Color('#F5F3EE')
  private buyEl: HTMLElement | null = null
  private pinEl: HTMLElement | null = null
  private sectionEl: HTMLElement | null = null
  private stageEl: HTMLElement | null = null
  private buyPos = new THREE.Vector3()
  private buyQuat = new THREE.Quaternion()
  private buyScale = 0.3
  private buySpin = 0
  private parentInv = new THREE.Matrix4()

  // pointer / picking
  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private needPick = false
  private hover = -1
  private cursorMode: 'default' | 'view' | 'drag' = 'default'
  private drag: {
    id: number
    x0: number
    y0: number
    lastX: number
    lastT: number
    vx: number
    base: number
    on: boolean
  } | null = null
  private dragOffset = 0
  private suppressClick = false
  private offBus: Array<() => void> = []
  private listeners: Array<() => void> = []

  // ------------------------------------------------------------ setup
  init(stage: Stage, asm: Assembly, _cfg: QualityConfig): void {
    this.stage = stage
    this.asm = asm
    this.motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.raycaster.layers.set(PICK_LAYER)
    // the hero always wears the Core finish outside the lineup
    if (asm.barrelMat) applyFinish(asm.barrelMat, FINISHES.Core)
    this.buildGeometry(asm)
    this.parent = asm.group.parent ?? stage.scene
    this.root.name = 'LineupRing'
    this.parent.add(this.root)
    for (let i = 0; i < VARIANT_ORDER.length; i++) this.members.push(this.buildMember(i))
    this.buildPlate()
    this.installFog(stage.scene)
    this.root.visible = false
    this.hideAll()
    this.offBus.push(
      bus.on('variant:select', ({ name, source }) => this.select(name, source)),
    )
    const release = (): void => {
      if (nav.hold >= 0 && performance.now() - nav.holdT > 90) releaseHold()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (/^(Arrow|Page|Home|End| )/.test(e.key) || e.key === ' ') release()
    }
    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchstart', release, { passive: true })
    window.addEventListener('keydown', onKey)
    this.listeners.push(() => {
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', release)
      window.removeEventListener('keydown', onKey)
    })
    this.refreshLayout()
    // Precompile the clones' programs so the ring's first appearance
    // doesn't hitch (members are hidden; compile() walks every object).
    const r = stage.renderer
    if (r.extensions.has('KHR_parallel_shader_compile')) {
      void r.compileAsync(stage.scene, stage.camera).catch(() => {})
    } else {
      r.compile(stage.scene, stage.camera)
    }
  }

  /** Merge each material's static meshes once (shared by all four clones). */
  private buildGeometry(asm: Assembly): void {
    const group = asm.group
    group.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert()
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
    const box = new THREE.Box3()
    const singles: { geometry: THREE.BufferGeometry; mat: THREE.Material; matrix: THREE.Matrix4 }[] = []
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material)) return
      const mat = mesh.material as THREE.Material
      // genuinely see-through internals (reservoir glass) are invisible
      // inside the barrel: skip them on the clones.
      if (mat.transparent && mat.opacity < 0.98) return
      const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
      if ((mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        singles.push({ geometry: mesh.geometry, mat, matrix: rel })
        return
      }
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
      }
      g.morphAttributes = {}
      g.applyMatrix4(rel)
      g.computeBoundingBox()
      if (g.boundingBox) box.union(g.boundingBox)
      let list = byMat.get(mat)
      if (!list) byMat.set(mat, (list = []))
      list.push(g)
    })
    const matIndex = (m: THREE.Material): number => {
      let i = this.srcMats.indexOf(m)
      if (i < 0) {
        i = this.srcMats.length
        this.srcMats.push(m)
      }
      return i
    }
    for (const [mat, list] of byMat) {
      const idx = matIndex(mat)
      if (mat === asm.barrelMat) this.barrelSrcIndex = idx
      // only merge geometries that share the same attribute set
      const buckets = new Map<string, THREE.BufferGeometry[]>()
      for (const g of list) {
        const key = Object.keys(g.attributes).sort().join(',')
        let b = buckets.get(key)
        if (!b) buckets.set(key, (b = []))
        b.push(g)
      }
      for (const b of buckets.values()) {
        const merged = b.length > 1 ? mergeGeometries(b, false) : b[0]
        if (merged) {
          if (merged !== b[0]) b.forEach((g) => g.dispose())
          merged.computeBoundingSphere()
          this.geoms.push({ geometry: merged, matIndex: idx })
          this.ownGeoms.push(merged)
        } else {
          for (const g of b) {
            this.geoms.push({ geometry: g, matIndex: idx })
            this.ownGeoms.push(g)
          }
        }
      }
    }
    for (const s of singles) {
      const idx = matIndex(s.mat)
      if (s.mat === asm.barrelMat) this.barrelSrcIndex = idx
      this.geoms.push({ geometry: s.geometry, matIndex: idx, matrix: s.matrix })
    }
    if (!box.isEmpty()) {
      this.pencilLen0 = Math.max(1e-3, box.max.y - box.min.y)
      this.pencilMidY = (box.max.y + box.min.y) / 2
    }
    this.sBase = PENCIL_LEN / this.pencilLen0
  }

  private buildMember(i: number): Member {
    const name = VARIANT_ORDER[i]
    const root = new THREE.Group()
    root.name = `ring-${name}`
    const mats = this.srcMats.map((m) => {
      const c = (m as THREE.MeshStandardMaterial).clone()
      // clones live in the opaque pass (the hero's shell clones toggle
      // transparency for x-ray; the ring never needs it)
      if (c.opacity >= 0.98) {
        c.transparent = false
        c.opacity = 1
        c.depthWrite = true
      }
      return c
    })
    const baseEnv = mats.map((m) => (m as THREE.MeshStandardMaterial).envMapIntensity ?? 1)
    const barrel =
      this.barrelSrcIndex >= 0 ? (mats[this.barrelSrcIndex] as THREE.MeshStandardMaterial) : null
    if (barrel) applyFinish(barrel, FINISHES[name])
    const meshes: THREE.Mesh[] = []
    for (const g of this.geoms) {
      const mat = mats[g.matIndex]
      let mesh: THREE.Mesh
      if (g.matrix) {
        mesh = new THREE.Mesh(g.geometry, mat)
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(g.matrix)
      } else {
        mesh = new THREE.Mesh(g.geometry, mat)
      }
      mesh.castShadow = false
      mesh.receiveShadow = false
      root.add(mesh)
      meshes.push(mesh)
    }
    // cheap pick proxy on its own layer: never rendered, never hit by
    // anyone else's raycasts. ~2x the barrel radius: a forgiving target.
    const proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.0, this.pencilLen0 * 1.04, 8),
      new THREE.MeshBasicMaterial(),
    )
    proxy.position.y = this.pencilMidY
    proxy.layers.set(PICK_LAYER)
    proxy.userData.ringIndex = i
    root.add(proxy)
    this.root.add(root)
    return {
      name,
      idx: i,
      root,
      meshes,
      mats: mats as THREE.MeshStandardMaterial[],
      baseEnv,
      barrel,
      proxy,
      theta: i * STEP,
      focus: 0,
      spin: 0.35 * i,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: this.sBase,
      visible: false,
      envK: 1,
    }
  }

  /** Rotary indexing plate: two hairline circles + degree ticks + index mark. */
  private buildPlate(): void {
    // unit radius; scaled to the live ring radius every frame
    const R = 1
    const ink = new THREE.Color('#141412')
    const mk = (opacity: number): THREE.LineBasicMaterial => {
      const m = new THREE.LineBasicMaterial({
        color: ink,
        transparent: true,
        opacity,
        depthWrite: false,
      })
      m.userData.baseOpacity = opacity
      this.plateMats.push(m)
      return m
    }
    // Segments are ordered by distance from the front (+z) alternating
    // left/right, so a growing draw range sweeps both ways out of the index
    // mark and closes at the back — drafted, like a compass stroke.
    const order = (n: number): number[] => {
      const o: number[] = []
      for (let k = 0; o.length < n; k++) {
        o.push(k)
        if (o.length < n && k > 0) o.push(n - k)
      }
      return o.filter((v, i, a) => a.indexOf(v) === i).slice(0, n)
    }
    const circle = (r: number, seg: number): THREE.BufferGeometry => {
      const pts: number[] = []
      for (const i of order(seg)) {
        // segment i spans angle [i, i+1]; mirror the left half so each
        // pair grows symmetrically from the front
        const a0 = (i / seg) * Math.PI * 2
        const a1 = ((i + 1) / seg) * Math.PI * 2
        pts.push(Math.sin(a0) * r, 0, Math.cos(a0) * r, Math.sin(a1) * r, 0, Math.cos(a1) * r)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      return g
    }
    const ticks = (): THREE.BufferGeometry => {
      const pts: number[] = []
      for (const i of order(72)) {
        const a = (i / 72) * Math.PI * 2
        const major = i % 18 === 0
        const mid = i % 6 === 0
        const r0 = major ? R * 0.8 : mid ? R * 1.1 : R * 1.15
        const r1 = R * 1.2
        pts.push(Math.sin(a) * r0, 0, Math.cos(a) * r0, Math.sin(a) * r1, 0, Math.cos(a) * r1)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      return g
    }
    const add = (g: THREE.BufferGeometry, m: THREE.LineBasicMaterial): void => {
      const l = new THREE.LineSegments(g, m)
      l.frustumCulled = false
      this.plateLines.push(l)
      this.plateCounts.push(g.getAttribute('position').count)
      this.ownGeoms.push(g)
      this.plateSpin.add(l)
    }
    add(circle(R * 1.2, 160), mk(0.42))
    add(circle(R * 0.8, 128), mk(0.2))
    add(ticks(), mk(0.34))
    // fixed index mark at the front slot (accent): a small filled triangle
    const tri = new THREE.BufferGeometry()
    const r = R * 1.27
    tri.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, r, -0.03, 0, r + 0.075, 0.03, 0, r + 0.075], 3),
    )
    this.ownGeoms.push(tri)
    const triMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#A63D22'),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    triMat.userData.baseOpacity = 0.9
    this.indexMark = new THREE.Mesh(tri, triMat)
    this.indexMark.frustumCulled = false
    this.plate.add(this.plateSpin, this.indexMark)
    this.root.add(this.plate)
  }

  private installFog(scene: THREE.Scene): void {
    // Fog is a program define: install it once, before anything compiles,
    // parked out of reach (no visual effect) until the lineup needs it.
    if (scene.fog instanceof THREE.Fog) {
      this.fog = scene.fog
      this.fogNear0 = scene.fog.near
      this.fogFar0 = scene.fog.far
    } else if (!scene.fog) {
      this.fog = new THREE.Fog(0xffffff, 1e5, 1e5 + 1)
      scene.fog = this.fog
    }
  }

  private hideAll(): void {
    for (const m of this.members) {
      m.root.visible = false
      m.visible = false
    }
  }

  // ------------------------------------------------------------ layout
  private refreshLayout(): void {
    this.vw = Math.max(1, window.innerWidth)
    this.vh = Math.max(1, window.innerHeight)
    this.docH = document.documentElement.scrollHeight
    this.maxScroll = Math.max(1, this.docH - this.vh)
    this.portrait = this.vw / this.vh < 0.9
    // tighter ring on portrait screens: bigger pencils for the same width
    this.R = this.portrait ? 1.7 : RADIUS
    const top = lineupTop()
    this.sectionEl = document.getElementById('lineup')
    this.pinEl = document.getElementById('lineupPin')
    this.stageEl = document.getElementById('ringStage')
    this.buyEl = document.getElementById('buyStage')
    if (top !== null) this.secTop = top
    // the stage box as it sits while the section is pinned (pin top = 0)
    if (this.stageEl && this.pinEl) {
      const sr = this.stageEl.getBoundingClientRect()
      const pr = this.pinEl.getBoundingClientRect()
      this.stageBox = { x: sr.left, y: sr.top - pr.top, w: sr.width, h: sr.height }
    } else {
      this.stageBox = this.portrait
        ? { x: 0, y: this.vh * 0.14, w: this.vw, h: this.vh * 0.46 }
        : { x: this.vw * 0.42, y: this.vh * 0.1, w: this.vw * 0.56, h: this.vh * 0.82 }
    }
    this.haveLayout = top !== null
    this.attachPointer()
    this.computeRingCamera()
  }

  /** Camera that frames the ring inside the stage box (pan = shifted lens). */
  private computeRingCamera(): void {
    const fov = this.portrait ? 32 : 28
    const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const aspect = this.vw / this.vh
    const b = this.stageBox
    const R = this.R
    const az = this.portrait ? 0.3 : AZIMUTH
    const el = this.portrait ? 0.24 : 0.27
    // front pencil projected length ≈ 78% of the box height
    const targetPx = Math.max(120, b.h * (this.portrait ? 0.8 : 0.78))
    const df = (PENCIL_LEN * Math.cos(el) * this.vh) / (2 * tanH * targetPx)
    let dist = df + R * Math.cos(az) * Math.cos(el)
    // keep the whole ring (plate rim incl.) inside the box width
    const rimPx = (r: number, d: number): number => (r * this.vh) / (2 * d * tanH)
    const needW = (d: number): number => 2 * rimPx(R * 1.28, d)
    if (needW(dist) > b.w * 0.98) dist = (R * 1.28 * this.vh) / (b.w * 0.98 * tanH)
    this.frontDist = dist - R * Math.cos(az) * Math.cos(el)
    this.pxPerDetent = Math.max(90, rimPx(R, dist) * 1.15)
    const dir = tmpV.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    // ring centre sits behind the front slot (front slot = world origin)
    const look = tmpV2.set(0, -PENCIL_LEN * 0.05, -R)
    this.camPos.copy(look).addScaledVector(dir, dist)
    this.camTgt.copy(look)
    // pan so the ring centre lands on the stage box centre
    const fwd = new THREE.Vector3().copy(dir).negate()
    const right = new THREE.Vector3().crossVectors(fwd, Y_AXIS).normalize()
    const up = new THREE.Vector3().crossVectors(right, fwd)
    const bx = ((b.x + b.w / 2) / this.vw) * 2 - 1
    const by = -(((b.y + b.h / 2) / this.vh) * 2 - 1)
    const halfH = dist * tanH
    const halfW = halfH * aspect
    this.camUp.copy(up)
    this.camHalfH = halfH
    const shift = right.multiplyScalar(bx * halfW).addScaledVector(up, by * halfH)
    this.camPos.sub(shift)
    this.camTgt.sub(shift)
    this.camFov = fov
  }

  private attachPointer(): void {
    const pin = this.pinEl
    if (!pin || pin.dataset.ringPointer === '1') return
    pin.dataset.ringPointer = '1'
    const interactive = (t: EventTarget | null): boolean =>
      t instanceof Element && !!t.closest('a,button,input,label,select,textarea,[data-no-pick]')
    const move = (e: PointerEvent): void => {
      this.ndc.set((e.clientX / this.vw) * 2 - 1, -(e.clientY / this.vh) * 2 + 1)
      this.needPick = !interactive(e.target)
      if (!this.needPick && this.hover >= 0) this.setHover(-1)
      const d = this.drag
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x0
        const dy = e.clientY - d.y0
        if (!d.on && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          d.on = true
          releaseHold()
          try {
            pin.setPointerCapture(e.pointerId)
          } catch {
            /* capture is best-effort */
          }
          pin.classList.add('is-dragging')
          this.setCursor('drag')
        }
        if (d.on) {
          const now = performance.now()
          const dt = Math.max(1, now - d.lastT) / 1000
          d.vx += ((e.clientX - d.lastX) / dt - d.vx) * 0.35
          d.lastX = e.clientX
          d.lastT = now
          this.dragOffset = -dx / this.pxPerDetent
          this.wake()
        }
      }
    }
    const down = (e: PointerEvent): void => {
      if (e.button !== 0 || interactive(e.target) || !this.ringVisible) return
      this.drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        lastX: e.clientX,
        lastT: performance.now(),
        vx: 0,
        base: nav.hold >= 0 ? nav.hold : ringTarget(this.uR),
        on: false,
      }
      this.suppressClick = false
    }
    const up = (e: PointerEvent): void => {
      const d = this.drag
      if (!d || d.id !== e.pointerId) return
      this.drag = null
      pin.classList.remove('is-dragging')
      if (d.on) {
        this.suppressClick = true
        const fling = (-d.vx * 0.25) / this.pxPerDetent
        const idx = ringIndex(d.base + this.dragOffset + fling)
        // the spring keeps its current (dragged) position and swings on
        this.dragOffset = 0
        gotoDetent(idx)
        this.setCursor(this.hover >= 0 ? 'view' : 'default')
        this.wake()
      }
    }
    const cancel = (e: PointerEvent): void => {
      if (this.drag?.id !== e.pointerId) return
      const wasOn = this.drag.on
      this.drag = null
      pin.classList.remove('is-dragging')
      if (wasOn) {
        const idx = ringIndex(ringTarget(this.uR) + this.dragOffset)
        this.dragOffset = 0
        gotoDetent(idx)
      }
      this.dragOffset = 0
    }
    const click = (e: MouseEvent): void => {
      if (this.suppressClick) {
        this.suppressClick = false
        return
      }
      if (interactive(e.target) || !this.ringVisible) return
      this.ndc.set((e.clientX / this.vw) * 2 - 1, -(e.clientY / this.vh) * 2 + 1)
      const hit = this.pick()
      if (hit < 0) return
      if (hit === this.frontIdx) {
        bus.emit('variant:select', { name: VARIANT_ORDER[hit], source: 'ring' })
        gotoBuy(hit)
      } else {
        gotoDetent(hit)
      }
    }
    const leave = (): void => {
      this.needPick = false
      this.setHover(-1)
    }
    pin.addEventListener('pointermove', move, { passive: true })
    pin.addEventListener('pointerdown', down, { passive: true })
    pin.addEventListener('pointerup', up, { passive: true })
    pin.addEventListener('pointercancel', cancel, { passive: true })
    pin.addEventListener('pointerleave', leave, { passive: true })
    pin.addEventListener('click', click)
    this.listeners.push(() => {
      pin.removeEventListener('pointermove', move)
      pin.removeEventListener('pointerdown', down)
      pin.removeEventListener('pointerup', up)
      pin.removeEventListener('pointercancel', cancel)
      pin.removeEventListener('pointerleave', leave)
      pin.removeEventListener('click', click)
      delete pin.dataset.ringPointer
    })
  }

  private wakeFlag = false
  private wake(): void {
    this.wakeFlag = true
  }

  private setCursor(mode: 'default' | 'view' | 'drag'): void {
    const label =
      mode === 'drag' ? 'Drag' : mode === 'view' ? (this.hover === this.frontIdx ? 'Choose' : 'Select') : undefined
    if (mode === this.cursorMode && mode !== 'view') return
    this.cursorMode = mode
    bus.emit('cursor', label ? { mode, label } : { mode })
  }

  private setHover(i: number): void {
    if (i === this.hover) return
    this.hover = i
    if (this.drag?.on) return
    this.setCursor(i >= 0 ? 'view' : 'default')
    if (this.pinEl) this.pinEl.style.cursor = i >= 0 ? 'pointer' : ''
  }

  private pick(): number {
    if (!this.stage) return -1
    this.raycaster.setFromCamera(this.ndc, this.stage.camera)
    let best = -1
    let bestD = Infinity
    for (const m of this.members) {
      if (!m.visible || (this.outW > 0.5 && m.idx === this.presenter)) continue
      m.proxy.updateMatrixWorld()
      const hits = this.raycaster.intersectObject(m.proxy, false)
      if (hits.length && hits[0].distance < bestD) {
        bestD = hits[0].distance
        best = m.idx
      }
    }
    return best
  }

  // ------------------------------------------------------------ API
  /** Buy radio / ring CTA / experience.setVariant → selected finish. */
  select(name: string, source: 'ring' | 'buy' | 'other' = 'other'): void {
    if (!isVariantName(name)) return
    this.selected = name
    this.chaseTarget = FINISHES[name]
    this.chaseLive = true
    if (source === 'ring') this.emittedIdx = VARIANT_ORDER.indexOf(name)
    this.wake()
  }

  /** Blend the choreography camera into the ring camera (fresh targets only). */
  applyCamera(pos: THREE.Vector3, tgt: THREE.Vector3): number {
    const w = this.camW
    if (w <= 0) return 0
    pos.lerp(this.camPosLive, w)
    tgt.lerp(this.camTgtLive, w)
    return w
  }

  get ringFov(): number {
    return this.camFov
  }

  /**
   * Hero handoff: the live assembly glides from its choreography pose into
   * the Core slot; once there it hides and the Core clone takes over.
   */
  poseHero(asm: Assembly): void {
    const w = this.inW
    if (w <= 0 || !this.active) {
      asm.group.visible = true
      return
    }
    if (w >= 0.999) {
      asm.group.visible = false
      return
    }
    asm.group.visible = true
    const core = this.members[0]
    const e = easeInOutCubic(w)
    // slot pose lives in the ring parent's space; bring it into the hero's
    this.toHeroSpace(core.pos, core.quat, asm.group)
    asm.group.position.lerp(tmpV, e)
    asm.group.quaternion.slerp(tmpQ, e)
    const s = asm.group.scale.x + (core.scale - asm.group.scale.x) * e
    asm.group.scale.setScalar(s)
  }

  /** ring-parent-space pose → asm.group parent space (into tmpV/tmpQ). */
  private toHeroSpace(p: THREE.Vector3, q: THREE.Quaternion, group: THREE.Object3D): void {
    const hp = group.parent
    if (!hp || hp === this.parent || !this.parent) {
      tmpV.copy(p)
      tmpQ.copy(q)
      return
    }
    this.parent.updateMatrixWorld()
    hp.updateMatrixWorld()
    tmpM.compose(p, q, tmpS.set(1, 1, 1)).premultiply(this.parent.matrixWorld)
    tmpM.premultiply(this.parentInv.copy(hp.matrixWorld).invert())
    tmpM.decompose(tmpV, tmpQ, tmpS)
  }

  // ------------------------------------------------------------ frame
  preUpdate(ctx: FrameCtx): void {
    if (!this.asm) return
    if (
      !this.haveLayout ||
      window.innerHeight !== this.vh ||
      window.innerWidth !== this.vw ||
      document.documentElement.scrollHeight !== this.docH
    ) {
      this.refreshLayout()
    }
    const now = performance.now()
    const sy = window.scrollY
    if (sy !== this.lastScrollY) {
      this.lastScrollY = sy
      this.lastScrollMoveT = now
    }
    this.uS = (ctx.p * this.maxScroll - this.secTop) / this.vh
    this.uR = (ctx.rawP * this.maxScroll - this.secTop) / this.vh
    const uS = this.uS
    this.active = uS > RING_IN[0] - 0.02
    this.inW = sstep(RING_IN[0], RING_IN[1], uS)
    this.camW = this.inW
    this.sinkW = sstep(RING_SINK[0], RING_SINK[1], uS)
    this.outW = sstep(RING_OUT[0], RING_OUT[1], uS)
    // portrait: the ring rides up with its section while it scrolls in, so
    // it never crosses the incoming header (landscape keeps a fixed frame)
    const follow = this.portrait ? Math.max(0, -uS) * this.vh : 0
    const k = ((2 * follow) / this.vh) * this.camHalfH
    this.camPosLive.copy(this.camPos).addScaledVector(this.camUp, k)
    this.camTgtLive.copy(this.camTgt).addScaledVector(this.camUp, k)

    // hold bookkeeping (programmatic scroll in flight)
    if (nav.hold >= 0) {
      // released on arrival, or when the programmatic scroll has stalled
      // (interrupted / clamped) — never just because it is slow
      const idle = now - this.lastScrollMoveT
      const arrived = Math.abs(sy - nav.holdY) < 3 && idle > 120
      if (arrived || (now - nav.holdT > 2500 && idle > 600)) releaseHold()
    }

    // ring position: scroll-mapped detents + spring mass
    const target =
      nav.hold >= 0 ? nav.hold : Math.min(LINEUP_COUNT - 1 + 0.3, Math.max(-0.3, ringTarget(this.uR) + this.dragOffset))
    if (!this.motionOK) {
      this.rho = ringIndex(target)
      this.rhoV = 0
    } else {
      // semi-implicit spring, sub-stepped (k≈110, ζ≈0.86: a precise detent)
      const k = 110
      const c = 2 * 0.86 * Math.sqrt(k)
      let left = Math.min(ctx.dt, 1 / 20)
      while (left > 1e-6) {
        const h = Math.min(left, 1 / 120)
        const a = -k * (this.rho - target) - c * this.rhoV
        this.rhoV += a * h
        this.rho += this.rhoV * h
        left -= h
      }
      if (Math.abs(this.rho - target) < 1e-4 && Math.abs(this.rhoV) < 1e-4) {
        this.rho = target
        this.rhoV = 0
      }
    }

    // presenter latch: whichever variant is selected when the exit starts
    if (this.outW > 0 && this.presenter < 0) {
      this.presenter = VARIANT_ORDER.indexOf(this.selected)
      setFinishState(this.chase, FINISHES[this.selected])
      this.chaseTarget = FINISHES[this.selected]
    } else if (this.outW <= 0 && this.presenter >= 0) {
      this.presenter = -1
    }

    this.computeSlots(ctx)
  }

  /** Slot pose of every member around the ring (ring-parent space). */
  private computeSlots(ctx: FrameCtx): void {
    const R = this.R
    const motion = this.motionOK
    const riseDist = PENCIL_LEN * 1.25
    const awayX = -Math.sin(AZIMUTH)
    const awayZ = -Math.cos(AZIMUTH)
    for (const m of this.members) {
      const theta = (m.idx - this.rho) * STEP
      m.theta = theta
      const c = Math.max(0, Math.cos(theta))
      m.focus = c * c * c * c
      if (motion && this.active) m.spin += ctx.dt * 0.32 * m.focus
      const s = this.sBase * (0.86 + 0.14 * m.focus)
      m.scale = s
      // Ry(theta) · Rz(-lean) · Ry(spin)
      m.quat.setFromAxisAngle(Y_AXIS, theta)
      tmpQ.setFromAxisAngle(Z_AXIS, -LEAN)
      m.quat.multiply(tmpQ)
      tmpQ.setFromAxisAngle(Y_AXIS, m.spin)
      m.quat.multiply(tmpQ)
      // slot midpoint on the rim; ring centre sits at (0,0,-R)
      m.pos.set(Math.sin(theta) * R, 0, Math.cos(theta) * R - R)
      // entry rise (siblings) / exit sink (everyone but the presenter)
      let off = 0
      if (m.idx !== 0) {
        const d = (Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) / Math.PI) * 0.16
        const rise = sstep(RING_RISE[0] + d, RING_RISE[0] + d + (RING_RISE[1] - RING_RISE[0]) * 0.75, this.uS)
        off = Math.max(off, 1 - rise)
      }
      if (m.idx !== this.presenter || this.presenter < 0) {
        const d = (m.focus > 0.5 ? 0.12 : 0) + (1 - Math.cos(theta)) * 0.03
        const sink = sstep(RING_SINK[0] + d, RING_SINK[1] + d, this.uS)
        off = Math.max(off, sink)
      }
      if (off > 0) {
        const o = off * off
        m.pos.y -= o * riseDist
        m.pos.x += awayX * off * R * 2.6
        m.pos.z += awayZ * off * R * 2.6
      }
      // centre the pencil's midpoint on the slot
      tmpV.set(0, this.pencilMidY * s, 0).applyQuaternion(m.quat)
      m.pos.sub(tmpV)
      m.visible = this.active && off < 0.995 && !(m.idx === 0 && this.inW < 0.999)
    }
  }

  update(ctx: FrameCtx): void {
    if (!this.stage || !this.asm) return
    const stage = this.stage
    const anyRing = this.active
    this.root.visible = anyRing
    this.ringVisible = anyRing && this.uS < LINEUP_PIN + 0.6 && this.inW > 0.6
    if (!anyRing) {
      this.parkFog()
      if (this.hover >= 0) this.setHover(-1)
      this.writeRingCss(0)
      return
    }
    stage.camera.updateMatrixWorld()
    if (this.parent) {
      this.parent.updateMatrixWorld()
      this.parentInv.copy(this.parent.matrixWorld).invert()
    }

    // buy slot (live DOM box → world, at the front slot's depth)
    if (this.outW > 0 && this.presenter >= 0) this.computeBuyPose(ctx)

    // finish chase for the presenter (buy radios)
    if (this.chaseLive) {
      const k = this.motionOK ? 1 - Math.exp(-7 * ctx.dt) : 1
      const t = this.chaseTarget
      tmpColor.setHex(t.color)
      this.chase.color.lerp(tmpColor, k)
      this.chase.roughness += (t.roughness - this.chase.roughness) * k
      this.chase.metalness += (t.metalness - this.chase.metalness) * k
      this.chase.env += (t.envIntensity - this.chase.env) * k
      const dc =
        Math.abs(this.chase.color.r - tmpColor.r) +
        Math.abs(this.chase.color.g - tmpColor.g) +
        Math.abs(this.chase.color.b - tmpColor.b) +
        Math.abs(this.chase.roughness - t.roughness) +
        Math.abs(this.chase.metalness - t.metalness)
      if (dc < 2e-4) {
        setFinishState(this.chase, t)
        this.chaseLive = false
      }
    }

    // Clones never cast into the key light's shadow map: grounding in the
    // lineup comes from the LOOK layer's contact shadows, and skipping it
    // saves a depth pass per pencil (plus a first-swing shader compile).
    const outE = easeInOutCubic(this.outW)
    for (const m of this.members) {
      const isPresenter = m.idx === this.presenter && this.outW > 0
      let pos = m.pos
      let quat = m.quat
      let scale = m.scale
      if (isPresenter) {
        this.buySpin += this.motionOK ? ctx.dt * 0.5 : 0
        tmpV.copy(m.pos).lerp(this.buyPos, outE)
        tmpQ.copy(m.quat).slerp(this.buyQuat, outE)
        pos = tmpV
        quat = tmpQ
        scale = m.scale + (this.buyScale - m.scale) * outE
      }
      m.root.visible = m.visible
      if (!m.visible) continue
      m.root.position.copy(pos)
      m.root.quaternion.copy(quat)
      m.root.scale.setScalar(scale)
      // per-pencil light response: side/back pencils go quieter
      const envK = isPresenter ? 1 : 0.5 + 0.5 * m.focus
      const barrel = m.barrel
      if (barrel) {
        const own = FINISHES[m.name]
        if (isPresenter) {
          const w = sstep(0.0, 0.45, this.outW)
          tmpColor.setHex(own.color).lerp(this.chase.color, w)
          barrel.color.copy(tmpColor)
          barrel.roughness = own.roughness + (this.chase.roughness - own.roughness) * w
          barrel.metalness = own.metalness + (this.chase.metalness - own.metalness) * w
          barrel.envMapIntensity = own.envIntensity + (this.chase.env - own.envIntensity) * w
        } else if (barrel.userData.finishDirty !== false) {
          applyFinish(barrel, own, envK)
          barrel.userData.finishDirty = false
        }
      }
      if (Math.abs(envK - m.envK) > 0.002 || isPresenter) {
        m.envK = envK
        for (let i = 0; i < m.mats.length; i++) {
          const mat = m.mats[i]
          if (mat === barrel) {
            if (!isPresenter) mat.envMapIntensity = FINISHES[m.name].envIntensity * envK
          } else mat.envMapIntensity = m.baseEnv[i] * envK
        }
      }
      if (isPresenter && barrel) barrel.userData.finishDirty = true
    }

    this.updatePlate()
    this.updateFog()

    // front variant → overlay + buy form (only while the ring is the story)
    const fi = ringIndex(this.rho)
    this.frontIdx = fi
    if (this.uS > RING_IN[0] && this.uS < LINEUP_PIN + 0.15 && fi !== this.emittedIdx) {
      this.emittedIdx = fi
      this.selected = VARIANT_ORDER[fi]
      this.chaseTarget = FINISHES[this.selected]
      this.chaseLive = true
      // Limited is the crescendo: a light streak across its facets as it
      // lands (LOOK layer's sweep, if present)
      if (fi === LINEUP_COUNT - 1 && this.motionOK && this.rhoV > 0) {
        const sweep = this.opts.lookup?.('lightSweep') as (SceneModule & { streak?: () => void }) | undefined
        sweep?.streak?.()
      }
      bus.emit('variant:active', { name: VARIANT_ORDER[fi] })
    }
    this.updateLeader()
    this.writeRingCss(this.rho)
    this.writeOutCss(sstep(LINEUP_PIN + 0.02, LINEUP_PIN + 0.38, this.uR))

    // hover pick (pointer moved since the last frame)
    if (this.needPick && !this.drag?.on && !pointer.coarse) {
      this.needPick = false
      this.setHover(this.ringVisible ? this.pick() : -1)
    } else if (!this.ringVisible && this.hover >= 0) {
      this.setHover(-1)
    }

    this.proximitySnap()
  }

  /** Leader callout: material line → front pencil's barrel (landscape). */
  private leadT = 0
  private leadO = -1
  private leadLine: SVGLineElement | null = null
  private leadDot: SVGCircleElement | null = null
  private leadMat: HTMLElement | null = null
  private leadStart = { x: 0, y: 0 }
  private leadEnd = { x: -1, y: -1 }
  private updateLeader(): void {
    if (!this.stage) return
    const settled = 1 - Math.min(1, Math.abs(this.rho - Math.round(this.rho)) * 6)
    const o = this.portrait || !this.ringVisible ? 0 : settled * sstep(0.85, 1, this.inW)
    const oq = Math.round(o * 100) / 100
    if (oq !== this.leadO) {
      this.leadO = oq
      this.sectionEl?.style.setProperty('--lead-o', String(oq))
    }
    if (o <= 0) return
    if (!this.leadLine?.isConnected) {
      // remounted per variant by React: restart the draw-on
      this.leadLine = document.getElementById('luLeadLine') as SVGLineElement | null
      this.leadDot = document.getElementById('luLeadDot') as SVGCircleElement | null
      this.leadEnd.x = -1
      this.leadDrawT = performance.now()
    }
    if (!this.leadMat?.isConnected) this.leadMat = document.querySelector<HTMLElement>('.lu-mat .roll-l:last-child')
    const line = this.leadLine
    const dot = this.leadDot
    if (!line || !dot) return
    const now = performance.now()
    // the label's width changes per variant: re-measure a few times a second
    if (now - this.leadT > 250 || this.leadEnd.x < 0) {
      this.leadT = now
      const pin = this.pinEl?.getBoundingClientRect()
      const r = this.leadMat?.getBoundingClientRect()
      if (r && pin) {
        this.leadStart.x = r.right + 18
        this.leadStart.y = r.top + r.height / 2 - pin.top
      }
      this.leadMat = document.querySelector<HTMLElement>('.lu-mat .roll-l:last-child')
    }
    const m = this.members[ringIndex(this.rho)]
    if (!m?.visible) return
    // the point on the barrel axis that sits level with the label, so the
    // leader runs dead horizontal (clamped to the barrel)
    const pinTop = this.pinEl ? this.pinEl.getBoundingClientRect().top : 0
    m.root.updateMatrixWorld()
    const cam = this.stage.camera
    tmpV.set(0, this.pencilMidY - this.pencilLen0 * 0.08, 0).applyMatrix4(m.root.matrixWorld).project(cam)
    tmpV2.set(0, this.pencilMidY + this.pencilLen0 * 0.3, 0).applyMatrix4(m.root.matrixWorld).project(cam)
    const ax = ((tmpV.x + 1) / 2) * this.vw
    const ay = ((1 - tmpV.y) / 2) * this.vh - pinTop
    const bx = ((tmpV2.x + 1) / 2) * this.vw
    const by = ((1 - tmpV2.y) / 2) * this.vh - pinTop
    const t = Math.min(1, Math.max(0, (this.leadStart.y - ay) / (by - ay || 1)))
    const ex = ax + (bx - ax) * t
    const ey = ay + (by - ay) * t
    const draw = Math.min(1, Math.max(0, (now - this.leadDrawT - 180) / 900))
    const drawing = draw < 1
    if (!drawing && Math.abs(ex - this.leadEnd.x) < 0.4 && Math.abs(ey - this.leadEnd.y) < 0.4) return
    this.leadEnd.x = ex
    this.leadEnd.y = ey
    line.setAttribute('x1', this.leadStart.x.toFixed(1))
    line.setAttribute('y1', this.leadStart.y.toFixed(1))
    line.setAttribute('x2', ex.toFixed(1))
    line.setAttribute('y2', ey.toFixed(1))
    dot.setAttribute('cx', ex.toFixed(1))
    dot.setAttribute('cy', ey.toFixed(1))
    // draw-on from the label toward the pencil (dash offset in px)
    const len = Math.hypot(ex - this.leadStart.x, ey - this.leadStart.y)
    const k = this.motionOK ? 1 - Math.pow(1 - draw, 3) : 1
    line.style.strokeDasharray = `${len.toFixed(1)} ${(len + 2).toFixed(1)}`
    line.style.strokeDashoffset = (len * (1 - k)).toFixed(1)
    if (drawing) this.wake()
  }
  private leadDrawT = 0

  private computeBuyPose(_ctx: FrameCtx): void {
    if (!this.stage) return
    const cam = this.stage.camera
    let cx = 0.5
    let cy = 0.5
    let hPx = this.vh * 0.4
    const el = this.buyEl && this.buyEl.isConnected ? this.buyEl : document.getElementById('buyStage')
    this.buyEl = el
    if (el) {
      const r = el.getBoundingClientRect()
      cx = (r.left + r.width / 2) / this.vw
      cy = (r.top + r.height / 2) / this.vh
      hPx = Math.min(r.height, r.width * 4)
    } else {
      cx = 0.25
      cy = 0.6
    }
    // ray through the box centre, at the front slot's depth
    tmpV2.set(cx * 2 - 1, -(cy * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize()
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion)
    const depth = this.frontDist / Math.max(0.2, tmpV2.dot(fwd))
    this.buyPos.copy(cam.position).addScaledVector(tmpV2, depth)
    // scale: the pencil spans ~88% of the box height at that depth
    const visH = 2 * this.frontDist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    const worldLen = ((hPx * 0.88) / this.vh) * visH
    this.buyScale = Math.max(0.02, worldLen / this.pencilLen0)
    // upright turntable with the ring's lean
    this.buyQuat.setFromAxisAngle(Z_AXIS, -LEAN * 0.6)
    tmpQ.setFromAxisAngle(Y_AXIS, this.buySpin + 0.6)
    this.buyQuat.multiply(tmpQ)
    // centre the pencil's midpoint on the box centre
    tmpV.set(0, this.pencilMidY * this.buyScale, 0).applyQuaternion(this.buyQuat)
    this.buyPos.sub(tmpV)
    // world → ring-parent space
    if (this.parent && this.parent !== this.stage.scene) {
      tmpM.compose(this.buyPos, this.buyQuat, tmpS.set(1, 1, 1)).premultiply(this.parentInv)
      tmpM.decompose(this.buyPos, this.buyQuat, tmpS)
    }
  }

  private updatePlate(): void {
    // draw on with the handoff, fade with the sink
    const draw = sstep(RING_IN[0] + 0.25, RING_IN[1] + 0.1, this.uS)
    const fade = 1 - this.sinkW
    this.plate.visible = draw > 0.001 && fade > 0.001
    if (!this.plate.visible) return
    this.plate.position.set(0, -PENCIL_LEN * 0.5 - 0.28, -this.R)
    this.plate.scale.setScalar(this.R)
    this.plateSpin.rotation.y = -this.rho * STEP
    for (let i = 0; i < this.plateLines.length; i++) {
      const l = this.plateLines[i]
      const n = this.plateCounts[i]
      // circles sweep around from the index mark; ticks follow slightly later
      const t = i === 2 ? sstep(0.35, 1, draw) : draw
      const cnt = Math.floor((n / 2) * t) * 2
      l.geometry.setDrawRange(0, cnt)
      const m = this.plateMats[i]
      m.opacity = (m.userData.baseOpacity as number) * fade
    }
    if (this.indexMark) {
      const m = this.indexMark.material as THREE.MeshBasicMaterial
      m.opacity = (m.userData.baseOpacity as number) * fade * sstep(0.6, 1, draw)
    }
  }

  private updateFog(): void {
    const fog = this.fog
    if (!fog || !this.stage) return
    // full strength until the sinkers are gone (the presenter flies at the
    // front slot's depth, never inside the fog)
    const w = this.inW * (1 - sstep(RING_SINK[1], RING_OUT[1], this.uS))
    if (w <= 0.001) {
      this.parkFog()
      return
    }
    const key = `${this.stage.renderer.toneMapping}:${this.stage.renderer.toneMappingExposure}`
    if (key !== this.fogKey) {
      this.fogKey = key
      inverseToneMap(tmpColor.copy(this.paper), this.stage.renderer, this.fogColor)
    }
    fog.color.copy(this.fogColor)
    const R = this.R
    const df = this.stage.camera.position.distanceTo(tmpV.set(0, 0, 0))
    // sides ≈ a third into the paper, the back pencil almost gone
    const near = df + R * 0.12 + (1 - w) * R * 6
    fog.near = near
    fog.far = near + R * 2.25
  }

  private parkFog(): void {
    if (!this.fog) return
    if (this.fog.near !== this.fogNear0 || this.fog.far !== this.fogFar0) {
      this.fog.near = this.fogNear0
      this.fog.far = this.fogFar0
    }
  }

  /** overlay dissolves as the ring collapses into Buy */
  private writeOutCss(v: number): void {
    const r = Math.round(v * 1000) / 1000
    if (r === this.lastOutCss) return
    this.lastOutCss = r
    const sec = this.sectionEl ?? document.getElementById('lineup')
    sec?.style.setProperty('--lu-out', String(r))
  }

  private writeRingCss(v: number): void {
    const r = Math.round(Math.min(LINEUP_COUNT - 1, Math.max(0, v)) * 1000) / 1000
    if (r === this.lastRingCss) return
    this.lastRingCss = r
    const sec = this.sectionEl ?? document.getElementById('lineup')
    sec?.style.setProperty('--ring', String(r))
  }

  /**
   * Proximity snap (lineup only): if scrolling stops mid-swing, finish the
   * swing to the nearest detent edge. Never while a finger/mouse is down,
   * dragging, or in a programmatic scroll.
   */
  private proximitySnap(): void {
    if (!this.motionOK || this.drag || nav.hold >= 0 || pointer.down || NO_SNAP) return
    const now = performance.now()
    if (now - this.lastScrollMoveT < 280) return
    const u = this.uR
    if (u <= 0 || u >= LINEUP_PIN) return
    const i = ringMoving(u)
    if (i < 0) return
    if (Math.abs(u - this.snapGuardU) < 0.002) return
    this.snapGuardU = u
    const [a, b] = RING_MOVES[i]
    const f = (u - a) / (b - a)
    const top = lineupTop()
    if (top === null) return
    const dest = f < 0.5 ? a - 0.04 : b + 0.04
    scrollToY(Math.round(top + dest * this.vh), true)
  }

  wantsFrame(): boolean {
    if (!this.active) return false
    if (this.wakeFlag) {
      this.wakeFlag = false
      return true
    }
    if (this.rhoV !== 0 || this.chaseLive || nav.hold >= 0 || this.drag) return true
    // turntables (front pencil, buy presenter) + snap watch while on screen
    return this.motionOK && this.uS < LINEUP_PIN + 3
  }

  onResize(): void {
    this.refreshLayout()
  }

  onMotionChange(ok: boolean): void {
    this.motionOK = ok
    this.wake()
  }

  /** Variant held in front during a programmatic scroll (QA). */
  get holdIdx(): number {
    return nav.hold
  }

  /** Document scrollY of a detent (exposed for debugging / QA). */
  detentY(i: number): number {
    return detentY(i)
  }

  dispose(): void {
    this.offBus.forEach((f) => f())
    this.listeners.forEach((f) => f())
    this.root.removeFromParent()
    for (const m of this.members) {
      m.mats.forEach((x) => x.dispose())
      m.proxy.geometry.dispose()
      ;(m.proxy.material as THREE.Material).dispose()
    }
    this.plateMats.forEach((m) => m.dispose())
    ;(this.indexMark?.material as THREE.Material | undefined)?.dispose()
    this.ownGeoms.forEach((g) => g.dispose())
    if (this.fog && this.stage?.scene.fog === this.fog && this.fogNear0 >= 1e5) this.stage.scene.fog = null
  }
}

const tmpColor = new THREE.Color()
