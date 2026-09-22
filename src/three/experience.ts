import * as THREE from 'three'
import { ANODIZED, detectConfig, type QualityConfig } from './config'
import { createStage, type Stage } from './stage'
import { loadAssembly, type Assembly } from './assembly'
import { sampleCam } from './cameraRig'
import {
  canvasDimF,
  detailF,
  explodeF,
  heroOffF,
  mechF,
  reOffF,
  sstep,
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
  private shellX = false
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
  // Lineup turntable: accumulated spin (time-based, so scrubbing back and
  // forth stays continuous) + smooth color chase toward the active card.
  private spin = 0
  private colorTarget = new THREE.Color(ANODIZED.Core)
  // True while a tint chase still has visible distance to cover — keeps
  // the loop ticking after scroll settles so variant clicks always play.
  private colorDirty = true
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
    const lineupSec = document.getElementById('lineup')
    if (lineupSec) lineupSec.style.height = `${window.innerHeight * 4}px`
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

  async init(): Promise<void> {
    this.refreshViewport()
    this.stage = await createStage(this.canvas, this.cfg)
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
    const lineupSec = document.getElementById('lineup')
    if (lineupSec) lineupSec.style.height = `${window.innerHeight * 4}px`
    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', this.onVis)
    this.stage.composer.render()
    this.loop()
  }

  setVariant(name: string): void {
    const hex = ANODIZED[name] ?? 0x1e2f4f
    if (this.colorTarget.getHex() !== hex) {
      this.colorTarget.setHex(hex)
      this.colorDirty = true
    }
  }

  setMotionOK(ok: boolean): void {
    this.motionOK = ok
    document.body.classList.toggle('reduced', !ok)
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
    // horizontal lineup
    const lineupSec = document.getElementById('lineup')
    const track = document.getElementById('lineupTrack')
    if (lineupSec && track) {
      const r = lineupSec.getBoundingClientRect()
      const total = r.height - window.innerHeight
      const lp = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0
      if (this.motionOK) {
        const dist = Math.max(0, track.scrollWidth - window.innerWidth + 60)
        track.style.transform = `translate3d(${-dist * lp}px,0,0)`
      }
      const variants = [...document.querySelectorAll<HTMLElement>('.variant[data-color]')]
      const vi = Math.min(variants.length - 1, Math.floor(lp * variants.length))
      // Chase card colors only while the lineup is actually on screen.
      // Past it (buy section), the buy form owns the tint — otherwise any
      // scroll tick would yank the color back to the last card.
      // Above it, settle back to the hero Core.
      const setTarget = (hex: number): void => {
        if (this.colorTarget.getHex() !== hex) {
          this.colorTarget.setHex(hex)
          this.colorDirty = true
        }
      }
      if (lp > 0 && lp < 1) {
        const v = variants[vi]
        if (v?.dataset.color) setTarget(parseInt(v.dataset.color))
      } else if (r.top >= window.innerHeight) {
        setTarget(ANODIZED.Core)
      }
    }
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
    // Settled-frame optimization — BUT keep ticking while the turntable
    // spins or a tint chase is in flight, otherwise the spin would freeze
    // the moment scrolling stops and variant clicks would never animate.
    if (!this.readProgress() && !this.firstFrame) {
      const idleSpin = this.motionOK && sstep(0.62, 0.72, this.cur) > 0
      if (!idleSpin && !this.colorDirty) return
    }
    const asm = this.asm
    const mob = this.mobEff
    const edge = this.edgeK
    this.cur += (this.tgtP - this.cur) * (this.motionOK ? 1 - Math.exp(-4 * dt) : 1)
    if (Math.abs(this.tgtP - this.cur) < 0.0004) this.cur = this.tgtP
    const p = this.cur
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
    if (this.firstFrame) {
      this.camPos.copy(this.vPos)
      this.camTgt.copy(this.vTgt)
      this.firstFrame = false
    }
    const k = this.motionOK ? 1 - Math.exp(-5 * dt) : 1
    // Lineup backdrop: tuck the spinning pencil behind/right and dolly out
    // so the cards stay readable (no fade-out anymore). Applied to the
    // FRESH per-frame targets (vPos/vTgt are reset by sampleCam every
    // frame) — never to the smoothed camPos/camTgt, which would integrate
    // the offset every frame and drift out of frame.
    const lineupDolly = sstep(0.62, 0.72, p)
    if (lineupDolly > 0.001) {
      this.vTgt.x -= 2.2 * lineupDolly
      this.vTgt.y += 1.6 * lineupDolly
      this.vTmp.copy(this.vPos).sub(this.vTgt)
      this.vTmp.multiplyScalar(1 + 1.4 * lineupDolly)
      this.vPos.copy(this.vTgt).add(this.vTmp)
    }
    // (buy handoff runs after the attitude code below)
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
    asm.group.position.x =
      (isSmall ? 1.7 : 1.05) * Math.max(heroOff, reOff * 0.8)
    asm.group.position.y = 0.2 + (isSmall ? 1.5 * heroOff : 0)
    // Lineup turntable: continuous time-based spin layered over the scroll
    // pose (ramps in with the lineup, stays on through buy).
    const lineupF = sstep(0.62, 0.72, p)
    if (this.motionOK) this.spin += dt * 0.55 * lineupF
    asm.group.rotation.y +=
      (p * 2.4 - 0.4 + ex * 0.5 + this.spin - asm.group.rotation.y) * pk
    // Lineup: lay the pencil flatter so it floats behind the cards like
    // the card renders (ramps both directions with the dolly weight).
    // Undone through the buy range so the finale stands upright again.
    const lineupTilt = sstep(0.62, 0.72, p)
    const buyUp = sstep(0.96, 1.0, p)
    asm.group.rotation.z +=
      (-0.42 + ex * 0.42 + mc * 0.1 - 0.8 * lineupTilt * (1 - buyUp) - asm.group.rotation.z) * pk
    // Gradual barrel tint chase — smooth in both scroll directions.
    if (asm.barrelMat) {
      const c = asm.barrelMat.color
      c.lerp(this.colorTarget, 1 - Math.exp(-8 * dt))
      const dr = c.r - this.colorTarget.r
      const dg = c.g - this.colorTarget.g
      const db = c.b - this.colorTarget.b
      if (dr * dr + dg * dg + db * db < 1e-8) {
        c.copy(this.colorTarget)
        this.colorDirty = false
      }
    }
    // Buy pose: the single model shrinks and settles into the left
    // whitespace while the turntable keeps spinning. Stand back upright
    // (undo the lineup lean) so the spin reads as a turntable, and land
    // centered in the open area at any window size.
    const buyW = sstep(0.96, 1.0, p)
    {
      const cam = this.stage.camera
      const dist = cam.position.distanceTo(asm.group.position)
      this.vTmp.setFromMatrixColumn(cam.matrixWorld, 0)
      this.vTmp2.setFromMatrixColumn(cam.matrixWorld, 1)
      const ox = -0.30 * dist * buyW
      const oy = -0.02 * dist * buyW
      asm.group.position.x += this.vTmp.x * ox + this.vTmp2.x * oy
      asm.group.position.y += this.vTmp.y * ox + this.vTmp2.y * oy
      // base z is always 0 (attitude never touches it), so assign —
      // += would strand an offset when scrolling back.
      asm.group.position.z = this.vTmp.z * ox + this.vTmp2.z * oy
    }
    asm.group.scale.setScalar(0.6 * (1 - buyW) + 0.35 * buyW)

    // parts — the multi-stage knock sequence drives related components
    const mScale = 0.7
    for (const pt of asm.parts) {
      const o = pt.node
      const y = pt.base.y + pt.explode * ex * mScale
      if (pt.mech === 'jaw') {
        const open = mc * 0.16 + ex * 0.1
        o.position.set(
          Math.cos(pt.jawAngle) * (0.11 + open),
          y + mc * -0.12,
          Math.sin(pt.jawAngle) * (0.11 + open),
        )
        continue
      }
      let yy = y
      if (pt.mech === 'button' || pt.mech === 'stem') yy += mc * -0.22
      if (pt.mech === 'actuator') yy += mc * -0.18
      if (pt.mech === 'rod') yy += mc * -0.14
      if (pt.mech === 'clutch') yy += mc * -0.06
      if (
        pt.mech === 'springMain' ||
        pt.mech === 'springBtn' ||
        pt.mech === 'springStab'
      ) {
        const c = pt.mech === 'springBtn' ? 0.32 : 0.28
        o.scale.y = 1 - mc * c
      }
      if (pt.mech === 'lead') yy += mc * 0.34
      if (pt.mech === 'sleeve') yy += mc * 0.1
      o.position.y = yy
    }

    // x-ray fades (shells leave the transparent pass when solid)
    const wantX = xr > 0.003
    if (wantX !== this.shellX) {
      this.shellX = wantX
      for (const m of asm.shellMats) {
        m.transparent = wantX
        m.needsUpdate = true
      }
    }
    for (const m of asm.shellMats) {
      m.opacity = 1 - xr * 0.85
      m.depthWrite = xr < 0.4
    }
    asm.coreMat?.emissive.setRGB(xr * 0.16, xr * 0.07, xr * 0.03)
    for (const m of asm.springMats) m.emissive.setRGB(xr * 0.12, xr * 0.12, xr * 0.13)
    asm.brassMat?.emissive.setRGB(xr * 0.1, xr * 0.06, xr * 0.02)

    // Canvas stays live through lineup + buy (single model throughout).
    const op = canvasDimF(p)
    if (Math.abs(op - this.lastOp) > 0.002) {
      this.canvas.style.opacity = op.toFixed(3)
      this.lastOp = op
    }
    this.stage.key.intensity = 3.2 + Math.sin(p * Math.PI * 2) * 0.25 + xr * 0.6

    this.stage.composer.render()
    const loadFill = document.getElementById('loadFill')
    if (loadFill) loadFill.style.width = '100%'
    const loader = document.getElementById('loader')
    if (loader && !loader.classList.contains('done')) {
      loader.classList.add('done')
      loader.setAttribute('aria-hidden', 'true')
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('visibilitychange', this.onVis)
    this.stage?.dispose()
  }
}
