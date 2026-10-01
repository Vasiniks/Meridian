import * as THREE from 'three'
import { detectConfig, type QualityConfig } from './config'
import { createStage, type Stage } from './stage'
import { loadAssembly, type Assembly } from './assembly'
import { sampleCam } from './cameraRig'
import type { FrameCtx, SceneModule } from './modules'
import { beginLoadTracking } from '../fx/loadProgress'
import type { RingModule } from './ring'
import { sizeLineup } from '../components/lineupNav'
import {
  canvasDimF,
  detailF,
  explodeF,
  heroOffF,
  mechF,
  reOffF,
  xrayF,
} from '../data/scroll'

export class PencilExperience {
  private stage: Stage | null = null
  private asm: Assembly | null = null
  private cfg: QualityConfig
  private canvas: HTMLCanvasElement
  private raf = 0
  private last = 0
  private visible = true
  private lastY = -1
  private cur = 0
  private tgtP = 0
  private firstFrame = true
  private lastOp = -1
  private camPos = new THREE.Vector3(3.6, 1.6, 8.8)
  private camTgt = new THREE.Vector3(0, 0, 0)
  private camFov = 35
  private vPos = new THREE.Vector3()
  private vTgt = new THREE.Vector3()
  private vTmp = new THREE.Vector3()
  private vTmp2 = new THREE.Vector3()
  private motionOK = true
  private disposed = false
  // Live viewport framing: aspect-driven fit + editorial offset weight.
  // Recomputed on every resize so framing survives window changes,
  // breakpoint crossings, and orientation flips.
  private aspect = 1
  private mobEff = 1
  private edgeK = 1
  // Pencil attitude, integrated here and written absolutely every frame so
  // transient offsets (ring handoff, pointer rigs) never accumulate.
  private attX = 0.08
  private attY = 0
  private attZ = -0.42
  private baseScale = 0.6
  // Lineup ring (src/three/ring.ts): owns the lineup camera, the hero
  // handoff into the ring, the variant finishes and the buy pose.
  private ring: RingModule | null = null
  // Pluggable scene modules (see modules.ts) + shared per-frame context.
  private modules: SceneModule[] = []
  private ready = false
  private t0 = performance.now()
  private prevTgtP = 0
  private scrollVel = 0
  private ctx: FrameCtx | null = null
  private refreshViewport(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.aspect = w / Math.max(1, h)
    // live breakpoint (not frozen at load): small-screen staging + base mob
    this.cfg.isSmall = w <= 900
    const base = this.cfg.isSmall ? 1.45 : 1
    this.cfg.mob = base
    // aspect fit: pull the camera back on narrow/portrait windows so the
    // subject always fits; 1.0 on wide landscape (choreography untouched)
    const fitM = Math.min(1.9, Math.max(1, 1.45 / this.aspect))
    this.mobEff = Math.max(base, fitM)
    // editorial off-center weight: full offset on landscape (text sits
    // clear of the product), fades to centered on portrait screens
    const t = (this.aspect - 0.75) / (1.25 - 0.75)
    this.edgeK = Math.min(1, Math.max(0, t * t * (3 - 2 * t)))
  }
  private onResize = () => {
    if (!this.stage) return
    this.refreshViewport()
    this.stage.setSize(window.innerWidth, window.innerHeight)
    sizeLineup(window.innerHeight)
    for (const m of this.modules) m.onResize?.(window.innerWidth, window.innerHeight)
    this.lastY = -1
  }
  private onVis = () => {
    this.visible = !document.hidden
    if (this.visible) {
      this.last = performance.now()
      this.loop()
    } else {
      cancelAnimationFrame(this.raf)
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.cfg = detectConfig()
    this.motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  get quality() {
    return this.cfg.quality
  }

  /** Register a scene module; initialised immediately if already loaded. */
  addModule(m: SceneModule): void {
    this.modules.push(m)
    if (this.ready && this.stage && this.asm) {
      void Promise.resolve(m.init?.(this.stage, this.asm, this.cfg)).catch((e) =>
        console.error(`[module ${m.name}] init failed`, e),
      )
    }
    this.lastY = -1
  }

  getModule<T extends SceneModule>(name: string): T | undefined {
    return this.modules.find((m) => m.name === name) as T | undefined
  }

  async init(): Promise<void> {
    this.refreshViewport()
    // real GLB/HDR byte progress -> bus 'load:progress' (preloader)
    const endLoad = beginLoadTracking()
    this.stage = await createStage(this.canvas, this.cfg).catch((e) => {
      endLoad()
      throw e
    })
    this.last = performance.now()
    try {
      this.asm = await loadAssembly(
        this.cfg.assetUrl,
        this.stage.scene,
        this.cfg.quality,
      )
    } catch (err) {
      this.showFallback()
      throw err
    } finally {
      endLoad()
    }
    document.querySelectorAll('.rv').forEach((el) => {
      new IntersectionObserver((es, o) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            o.disconnect()
          }
        }),
      { threshold: 0.18 }).observe(el)
    })
    sizeLineup(window.innerHeight)
    this.attX = this.asm.group.rotation.x
    this.attY = this.asm.group.rotation.y
    this.attZ = this.asm.group.rotation.z
    this.baseScale = this.asm.group.scale.x
    for (const m of this.modules) {
      try {
        await m.init?.(this.stage, this.asm, this.cfg)
      } catch (e) {
        console.error(`[module ${m.name}] init failed`, e)
      }
    }
    this.ready = true
    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVis)
    this.stage.composer.render()
    this.loop()
  }

  /** Buy-form selection → the ring's presenter finish chase. */
  setVariant(name: string): void {
    this.ringModule()?.select(name, 'buy')
    this.lastY = -1
  }

  private ringModule(): RingModule | null {
    if (!this.ring) this.ring = this.getModule<RingModule>('ring') ?? null
    return this.ring
  }

  setMotionOK(ok: boolean): void {
    this.motionOK = ok
    document.body.classList.toggle('reduced', !ok)
    for (const m of this.modules) m.onMotionChange?.(ok)
    this.lastY = -1
  }

  isMotionOK(): boolean {
    return this.motionOK
  }

  private showFallback(): void {
    const fb = document.getElementById('fallback')
    if (fb) fb.style.display = 'flex'
    this.canvas.style.display = 'none'
    document.getElementById('loader')?.classList.add('done')
  }

  private readProgress(): boolean {
    const y = window.scrollY
    if (y === this.lastY && Math.abs(this.tgtP - this.cur) < 0.0006) return false
    this.lastY = y
    const max = document.documentElement.scrollHeight - window.innerHeight
    this.tgtP = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0
    const progressFill = document.getElementById('progressFill')
    if (progressFill) progressFill.style.transform = `scaleX(${this.tgtP})`
    document.getElementById('nav')?.classList.toggle('scrolled', y > 40)
    // (lineup: the ring module maps section-local scroll itself)
    // mechanism steps highlight
    const mechSec = document.getElementById('mechanism')
    if (mechSec) {
      const r = mechSec.getBoundingClientRect()
      const mp = Math.min(
        1,
        Math.max(0, (window.innerHeight * 0.6 - r.top) / r.height),
      )
      const si = Math.min(4, Math.floor(mp * 5))
      document.querySelectorAll<HTMLElement>('.step').forEach((s, i) => {
        s.dataset.on = this.motionOK ? String(i <= si) : 'true'
      })
    }
    return true
  }

  private loop = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    if (!this.visible || !this.stage || !this.asm) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const kf = this.motionOK ? 1 - Math.exp(-6 * dt) : 1
    // Settled-frame optimization — modules (ring turntable, finish chase,
    // detent spring) keep the loop alive through wantsFrame().
    const moved = this.readProgress()
    // scroll velocity (progress units / s), smoothed — feeds velocity FX
    const instVel = dt > 0 ? (this.tgtP - this.prevTgtP) / dt : 0
    this.prevTgtP = this.tgtP
    this.scrollVel += (instVel - this.scrollVel) * (1 - Math.exp(-10 * dt))
    if (Math.abs(this.scrollVel) < 1e-4) this.scrollVel = 0
    if (!moved && !this.firstFrame) {
      const modWants = this.modules.some((m) => m.wantsFrame?.() === true)
      if (!modWants && this.scrollVel === 0) return
    }
    const asm = this.asm
    const mob = this.mobEff
    const edge = this.edgeK
    // λ=9 (was 4): Lenis already smooths the page; avoid double-damping lag
    this.cur += (this.tgtP - this.cur) * (this.motionOK ? 1 - Math.exp(-9 * dt) : 1)
    if (Math.abs(this.tgtP - this.cur) < 0.0004) this.cur = this.tgtP
    const p = this.cur
    const ctx = this.frameCtx(p, dt, now)
    for (const m of this.modules) m.preUpdate?.(ctx)
    const ex = explodeF(p)
    const xr = xrayF(p)
    const mc = mechF(p)

    // camera (+ runtime macro tracking keeps true side views)
    const { fov, label } = sampleCam(p, mob, this.vPos, this.vTgt)
    this.camFov += (fov - this.camFov) * kf
    const sceneLabel = document.getElementById('sceneLabel')
    if (sceneLabel) sceneLabel.textContent = label
    const df = detailF(p)
    // Macro fit: compensate the horizontal-FOV squeeze on narrow windows
    // so the tracked subject stays framed. 1.0 on landscape (untouched).
    const fitMacro = Math.max(mob, 1 / Math.min(1, this.aspect))
    if (df > 0.001 && asm.gripNode) {
      asm.gripNode.getWorldPosition(this.vTmp)
      this.vTmp2.set(2.9 * fitMacro, 0, 3.9 * fitMacro).add(this.vTmp)
      this.vPos.lerp(this.vTmp2, df)
      this.vTgt.lerp(this.vTmp, df)
      // editorial side offset only on wide screens; centered otherwise
      this.vTgt.x -= 0.35 * df * edge
      this.camFov += (31 - this.camFov) * kf * df
    }
    if (mc > 0.001 && asm.jawNodes.length > 0) {
      asm.jawNodes[0].getWorldPosition(this.vTmp)
      this.vTmp2.set(2.0 * fitMacro, 0.55, 2.4 * fitMacro).add(this.vTmp)
      this.vPos.lerp(this.vTmp2, mc)
      this.vTgt.lerp(this.vTmp, mc)
      this.vTgt.x -= 0.25 * mc * edge
      this.camFov += (24 - this.camFov) * kf * mc
    }
    // Lineup + buy: blend into the ring's own framing (fresh targets only —
    // camPos/camTgt are the smoothed state and must never be offset).
    const ring = this.ringModule()
    if (ring) {
      const rw = ring.applyCamera(this.vPos, this.vTgt)
      if (rw > 0) this.camFov += (ring.ringFov - this.camFov) * kf * rw
    }
    if (this.firstFrame) {
      this.camPos.copy(this.vPos)
      this.camTgt.copy(this.vTgt)
      this.firstFrame = false
    }
    const k = this.motionOK ? 1 - Math.exp(-9 * dt) : 1 // λ=9 (was 5), see Lenis
    this.camPos.lerp(this.vPos, k)
    this.camTgt.lerp(this.vTgt, k)
    this.stage.camera.position.copy(this.camPos)
    this.stage.camera.lookAt(this.camTgt)
    if (Math.abs(this.stage.camera.fov - this.camFov) > 0.01) {
      this.stage.camera.fov = this.camFov
      this.stage.camera.updateProjectionMatrix()
    }

    // pencil attitude (+ hero offset so the headline sits clear)
    const pk = this.motionOK ? 1 - Math.exp(-3.5 * dt) : 1
    const heroOff = heroOffF(p)
    const reOff = reOffF(p)
    const isSmall = this.cfg.isSmall
    asm.group.position.set(
      (isSmall ? 1.7 : 1.05) * Math.max(heroOff, reOff * 0.8),
      0.2 + (isSmall ? 1.5 * heroOff : 0),
      0,
    )
    this.attY += (p * 2.4 - 0.4 + ex * 0.5 - this.attY) * pk
    this.attZ += (-0.42 + ex * 0.42 + mc * 0.1 - this.attZ) * pk
    asm.group.rotation.set(this.attX, this.attY, this.attZ)
    asm.group.scale.setScalar(this.baseScale)
    // Lineup handoff: the hero glides into the ring's front slot, then the
    // ring's Core clone takes over (identical pose + finish). The buy pose
    // and every variant finish live in ring.ts.
    ring?.poseHero(asm)

    // parts / mechanism springs + x-ray scan: src/three/drawing (modules)

    // Canvas stays live through lineup + buy (single model throughout).
    const op = canvasDimF(p)
    if (Math.abs(op - this.lastOp) > 0.002) {
      this.canvas.style.opacity = op.toFixed(3)
      this.lastOp = op
    }
    this.stage.key.intensity = 3.2 + Math.sin(p * Math.PI * 2) * 0.25 + xr * 0.6

    for (const m of this.modules) m.update?.(ctx)
    this.stage.composer.render()
    const loadFill = document.getElementById('loadFill')
    if (loadFill) loadFill.style.width = '100%'
    const loader = document.getElementById('loader')
    if (loader && !loader.classList.contains('done')) {
      loader.classList.add('done')
      loader.setAttribute('aria-hidden', 'true')
    }
  }

  private frameCtx(p: number, dt: number, now: number): FrameCtx {
    const c =
      this.ctx ??
      (this.ctx = {
        p,
        rawP: this.tgtP,
        scrollVel: 0,
        dt,
        time: 0,
        stage: this.stage!,
        asm: this.asm!,
        cfg: this.cfg,
        motionOK: this.motionOK,
        aspect: this.aspect,
      })
    c.p = p
    c.rawP = this.tgtP
    c.scrollVel = this.scrollVel
    c.dt = dt
    c.time = (now - this.t0) / 1000
    c.motionOK = this.motionOK
    c.aspect = this.aspect
    return c
  }

  dispose(): void {
    this.disposed = true
    for (const m of this.modules) m.dispose?.()
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVis)
    this.stage?.dispose()
  }
}
