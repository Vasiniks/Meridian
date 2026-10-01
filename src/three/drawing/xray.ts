import * as THREE from 'three'
import type { Assembly } from '../assembly'
import type { FrameCtx, SceneModule } from '../modules'
import type { Stage } from '../stage'
import { sstep } from '../../data/scroll'
import { type DrawingState, ramp, SCAN } from './state'

const VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`

const FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uInkY0;
uniform float uInkY1;
uniform float uInkMix;
uniform float uOpacity;
uniform float uPitch;
uniform float uLineW;
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <clipping_planes_fragment>
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.2);
  // 45° section hatching, screen-locked hairlines (technical-drawing language)
  float d = mod(gl_FragCoord.x + gl_FragCoord.y, uPitch);
  float hatch = step(d, uLineW);
  float inInk = step(uInkY0, gl_FragCoord.y) * step(gl_FragCoord.y, uInkY1) * uInkMix;
  vec3 col = mix(uInk, uPaper, inInk);
  float a = rim * mix(0.62, 0.9, inInk)
          + hatch * mix(0.16, 0.24, inInk) * (1.0 - 0.6 * rim)
          + mix(0.015, 0.03, inInk);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity);
}`

interface Ghost {
  src: THREE.Mesh
  mesh: THREE.Mesh
}

/**
 * The X-ray scan — the site's one tonal inversion.
 * Above the scan line the shells render as a hatched, rim-lit "ghost"
 * (paper hairlines on an ink sheet that sits behind the canvas); below it
 * the solid object on paper. Split by a clipping plane through the camera
 * that contains the screen-space scan line, so the 3D cut and the DOM ink
 * edge are pixel-identical. Clipping is only enabled while a cut is on
 * screen; the full x-ray state just swaps shells for ghosts.
 */
export class XrayModule implements SceneModule {
  readonly name = 'drawing:xray'
  private stage: Stage | null = null
  private asm: Assembly | null = null
  private ghosts: Ghost[] = []
  private ghostRoot = new THREE.Group()
  private ghostMat: THREE.ShaderMaterial
  private plane = new THREE.Plane()
  private solidPlane = new THREE.Plane()
  private ghostPlane = new THREE.Plane()
  private solidPlanes = [this.solidPlane]
  private ghostPlanes = [this.ghostPlane]
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private u = new THREE.Vector3()
  private n = new THREE.Vector3()
  private ink: HTMLDivElement | null = null
  private inkClip = ''
  private inkOp = -1
  private shellTransparent = false
  private shellHidden = false
  private ghostsOn = false
  private lastMode = ''
  private card: HTMLElement | null = null
  private nextText: Element | null = null
  private prevText: Element | null = null
  private cardVars = ''
  private bodyNeg = false
  private bodyNegTop = false

  constructor(private st: DrawingState) {
    this.ghostMat = new THREE.ShaderMaterial({
      name: 'xray-ghost',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uInk: { value: new THREE.Color(0.012, 0.012, 0.011) },
        uPaper: { value: new THREE.Color(1.25, 1.22, 1.15) },
        uInkY0: { value: 0 },
        uInkY1: { value: 0 },
        uInkMix: { value: 1 },
        uOpacity: { value: 1 },
        uPitch: { value: 5 },
        uLineW: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      clipping: true,
    })
    this.ghostRoot.name = 'XrayGhosts'
  }

  init(stage: Stage, asm: Assembly): void {
    this.stage = stage
    this.asm = asm
    if (this.st.asm !== asm) this.st.build(asm)
    // ghosts: one per shell mesh, geometry shared, world matrix copied from
    // the source each frame (kept outside asm.group so clones of the
    // assembly never pick them up)
    for (const info of this.st.nodes) {
      if (info.entry.kind !== 'shell') continue
      for (const src of info.meshes) {
        const mesh = new THREE.Mesh(src.geometry, this.ghostMat)
        mesh.matrixAutoUpdate = false
        mesh.matrixWorldAutoUpdate = false
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.renderOrder = 2
        mesh.name = `${info.entry.name}:ghost`
        this.ghostRoot.add(mesh)
        this.ghosts.push({ src, mesh })
      }
    }
    this.ghostRoot.visible = false
    stage.scene.add(this.ghostRoot)
    for (const m of asm.shellMats) m.clippingPlanes = this.solidPlanes
    this.ghostMat.clippingPlanes = this.ghostPlanes

    // DOM ink sheet: before #root so it paints under #gl at z-index 0
    let ink = document.getElementById('dr-ink') as HTMLDivElement | null
    if (!ink) {
      ink = document.createElement('div')
      ink.id = 'dr-ink'
      ink.setAttribute('aria-hidden', 'true')
      document.body.insertBefore(ink, document.body.firstChild)
    }
    this.ink = ink
    this.warmUp()
  }

  /** Compile the clip / ghost program variants up front (behind the loader). */
  private warmUp(): void {
    const stage = this.stage!
    const r = stage.renderer
    try {
      this.syncGhosts()
      this.ghostRoot.visible = true
      this.solidPlane.set(new THREE.Vector3(0, 1, 0), 0)
      this.ghostPlane.set(new THREE.Vector3(0, -1, 0), 0)
      r.localClippingEnabled = true
      stage.composer.render()
      r.localClippingEnabled = false
      stage.composer.render()
    } catch (e) {
      console.warn('[drawing:xray] warm-up skipped', e)
    }
    this.ghostRoot.visible = false
    r.localClippingEnabled = false
  }

  private syncGhosts(): void {
    this.stage!.scene.updateMatrixWorld()
    for (const g of this.ghosts) g.mesh.matrixWorld.copy(g.src.matrixWorld)
  }

  private textEdges(): { top: number; bot: number } {
    const vp = this.st.vp
    if (!this.nextText || !this.nextText.isConnected) {
      this.nextText = document.querySelector('#mechanism :is(h1,h2,h3,p,li)')
    }
    if (!this.prevText || !this.prevText.isConnected) {
      const all = document.querySelectorAll('#exploded :is(h1,h2,h3,p,li,span)')
      this.prevText = all.length ? all[all.length - 1] : null
    }
    let bot = vp.h
    let top = 0
    if (this.nextText) {
      const r = this.nextText.getBoundingClientRect()
      if (r.height > 0) bot = Math.min(bot, r.top - 28)
    }
    if (this.prevText) {
      const r = this.prevText.getBoundingClientRect()
      if (r.height > 0) top = Math.max(top, r.bottom + 28)
    }
    return { top, bot }
  }

  /** world clip plane containing the camera and the screen line y (px) */
  private setPlane(y: number): void {
    const cam = this.stage!.camera
    const vp = this.st.vp
    const ny = 1 - (2 * (y - vp.top)) / vp.h
    this.a.set(-1, ny, 0.5).unproject(cam).sub(cam.position)
    this.b.set(1, ny, 0.5).unproject(cam).sub(cam.position)
    this.n.crossVectors(this.b, this.a).normalize()
    this.plane.setFromNormalAndCoplanarPoint(this.n, cam.position)
    this.u.set(0, ny + 0.25, 0.5).unproject(cam)
    if (this.plane.distanceToPoint(this.u) < 0) this.plane.negate()
  }

  update(ctx: FrameCtx): void {
    const st = this.st
    const asm = this.asm
    const stage = this.stage
    if (!asm || !stage) return
    const p = ctx.p
    const vp = st.vp
    const H = vp.h
    const motion = ctx.motionOK

    // ---- envelopes ---------------------------------------------------------
    const edges = this.textEdges()
    let mode: typeof st.mode = 'off'
    let cutY = NaN
    let lineY = NaN
    let inkTop = 0
    let inkBot = 0
    let inkAlpha = 0
    let fade = 0
    if (motion) {
      const yIn = -0.02 * H + ramp(SCAN.inA, SCAN.inB, p) * 1.04 * H
      const yEnd = -0.02 * H + ramp(SCAN.endA, SCAN.endB, p) * 1.04 * H
      if (p >= SCAN.inA && p < SCAN.inB) {
        mode = 'enter'
        cutY = Math.min(yIn, edges.bot)
        lineY = cutY
      } else if (p >= SCAN.inB && p < SCAN.endA) {
        mode = 'full'
      } else if (p >= SCAN.endA && p < SCAN.endB) {
        mode = 'exit'
        cutY = yEnd
        lineY = yEnd
      }
      if (p >= SCAN.inA && p < SCAN.outB) {
        inkTop = edges.top
        if (p < SCAN.outA) inkBot = Math.min(p < SCAN.inB ? yIn : H, edges.bot)
        else {
          inkBot = Math.min(H * (1 - ramp(SCAN.outA, SCAN.outB, p)), edges.bot)
          lineY = inkBot > 1 ? inkBot : NaN
        }
        inkAlpha = 1
      }
    } else {
      fade = sstep(SCAN.inA, SCAN.inB, p) * (1 - sstep(SCAN.endA, SCAN.endB, p))
      if (fade > 0.001) mode = 'fade'
      inkAlpha = sstep(SCAN.inA, SCAN.inB, p) * (1 - sstep(SCAN.outA, SCAN.outB, p))
      if (inkAlpha > 0.001) {
        inkTop = edges.top
        inkBot = edges.bot
      }
    }
    if (inkBot <= inkTop + 1) {
      inkAlpha = 0
      inkBot = inkTop = 0
    }
    st.mode = mode
    st.cutY = cutY
    st.lineY = lineY
    st.inkTop = inkTop
    st.inkBot = inkBot
    st.inkAlpha = inkAlpha
    st.xr = motion
      ? sstep(SCAN.inA - 0.01, SCAN.inA + 0.012, p) * (1 - sstep(SCAN.endB - 0.012, SCAN.endB, p))
      : fade

    // ---- 3D ------------------------------------------------------------------
    const ghostsOn = mode !== 'off'
    const clip = mode === 'enter' || mode === 'exit'
    stage.renderer.localClippingEnabled = clip
    if (ghostsOn !== this.ghostsOn) {
      this.ghostsOn = ghostsOn
      this.ghostRoot.visible = ghostsOn
    }
    const hide = mode === 'full'
    if (hide !== this.shellHidden) {
      this.shellHidden = hide
      for (const m of asm.shellMats) m.visible = !hide
    }
    const transp = mode === 'fade'
    if (transp !== this.shellTransparent) {
      this.shellTransparent = transp
      for (const m of asm.shellMats) {
        m.transparent = transp
        m.depthWrite = true
        m.opacity = 1
        m.needsUpdate = true
      }
    }
    if (transp) {
      for (const m of asm.shellMats) {
        m.opacity = 1 - fade
        m.depthWrite = fade < 0.5
      }
    }
    if (clip) {
      stage.camera.updateMatrixWorld()
      this.setPlane(cutY)
      if (mode === 'enter') {
        this.ghostPlane.copy(this.plane)
        this.solidPlane.copy(this.plane).negate()
      } else {
        this.solidPlane.copy(this.plane)
        this.ghostPlane.copy(this.plane).negate()
      }
    }
    if (ghostsOn) {
      this.syncGhosts()
      const u = this.ghostMat.uniforms
      const dpr = vp.dpr
      u.uInkY0.value = (H - inkBot + vp.top) * dpr
      u.uInkY1.value = (H - inkTop + vp.top) * dpr
      u.uInkMix.value = inkAlpha
      u.uOpacity.value = mode === 'fade' ? fade : 1
      u.uPitch.value = Math.round(5 * dpr)
      u.uLineW.value = Math.max(1, Math.round(dpr * 0.75))
    }
    // internals lift so they read as x-ray (strongest on the ink sheet)
    const xr = st.xr
    const lift = xr * (0.6 + 0.4 * inkAlpha)
    asm.coreMat?.emissive.setRGB(lift * 0.16, lift * 0.07, lift * 0.03)
    for (const m of asm.springMats) m.emissive.setRGB(lift * 0.12, lift * 0.12, lift * 0.13)
    asm.brassMat?.emissive.setRGB(lift * 0.12, lift * 0.07, lift * 0.02)

    // ---- DOM: ink sheet, negative card, body flags --------------------------
    this.syncDom(inkTop, inkBot, inkAlpha)
    if (mode !== this.lastMode) this.lastMode = mode
  }

  private syncDom(inkTop: number, inkBot: number, inkAlpha: number): void {
    const ink = this.ink
    const vp = this.st.vp
    const H = vp.h
    const on = inkAlpha > 0.001 && inkBot > inkTop + 1
    if (ink) {
      const clip = on
        ? `inset(${Math.round(inkTop)}px 0px ${Math.round(Math.max(0, H - inkBot))}px 0px)`
        : 'inset(0px 0px 100% 0px)'
      if (clip !== this.inkClip) {
        this.inkClip = clip
        ink.style.clipPath = clip
        ink.style.visibility = on ? 'visible' : 'hidden'
      }
      const op = on ? Math.round(inkAlpha * 100) / 100 : 0
      if (op !== this.inkOp) {
        this.inkOp = op
        ink.style.opacity = String(op)
      }
    }
    // negative copy of the X-ray card, clipped to the ink sheet
    if (!this.card || !this.card.isConnected) this.card = document.querySelector('#xray .xr-card')
    if (this.card) {
      let vars = 'off'
      if (on) {
        const r = this.card.getBoundingClientRect()
        const t = Math.max(0, inkTop - r.top)
        const b = Math.max(0, r.bottom - inkBot)
        if (t < r.height && b < r.height) vars = `${Math.round(t)}|${Math.round(b)}|${inkAlpha.toFixed(2)}`
      }
      if (vars !== this.cardVars) {
        this.cardVars = vars
        if (vars === 'off') this.card.classList.remove('is-neg')
        else {
          const [t, b, a] = vars.split('|')
          this.card.classList.add('is-neg')
          this.card.style.setProperty('--xr-t', `${t}px`)
          this.card.style.setProperty('--xr-b', `${b}px`)
          this.card.style.setProperty('--xr-a', a)
        }
      }
    }
    const neg = on
    if (neg !== this.bodyNeg) {
      this.bodyNeg = neg
      document.body.classList.toggle('dr-neg', neg)
    }
    const negTop = on && inkTop < 90 && inkBot > 96
    if (negTop !== this.bodyNegTop) {
      this.bodyNegTop = negTop
      document.body.classList.toggle('dr-neg-top', negTop)
    }
  }

  dispose(): void {
    this.ghostRoot.removeFromParent()
    this.ghostMat.dispose()
    this.ink?.remove()
    document.body.classList.remove('dr-neg', 'dr-neg-top')
  }
}
