import * as THREE from 'three'
import type { Assembly } from '../assembly'
import type { FrameCtx, SceneModule } from '../modules'
import type { Stage } from '../stage'
import { bus, type CursorMode } from '../../fx/bus'
import { pointer } from '../../fx/pointer'
import { explodeF, mechF } from '../../data/scroll'
import { Anchor, arrowPts, flag, Label, PolyPath, svg } from '../../overlay/svg'
import { cursorLabel, DIM, MECH_STEPS, pad2, XRAY_LABELS } from '../../overlay/drawingCopy'
import { DETAIL_ON, type DrawingState, type NodeInfo, REASSEMBLY_ON, SCAN, TIP_ON } from './state'
import { Picker } from './picking'
import { buildProfile, type Profile } from './profile'
import '../../overlay/drawing.css'

interface Pt {
  x: number
  y: number
  ok: boolean
}
const pt = (): Pt => ({ x: 0, y: 0, ok: false })

const UI_SEL = 'a,button,input,select,textarea,label,summary,[role="button"],[data-cursor],[data-no-pick]'
const ACCENT = new THREE.Color(0xa63d22)

/** One draw-on unit (CSS drives the dashoffset/opacity transitions). */
class Callout {
  readonly g: SVGGElement
  on = false
  vis = true
  constructor(parent: Element, cls = '') {
    this.g = svg('g', { class: `dr-c ${cls}`.trim() }, parent)
  }
  set(on: boolean, delay = 0): void {
    if (on === this.on) return
    this.on = on
    if (on) this.g.style.setProperty('--d', `${Math.round(delay)}ms`)
    flag(this.g, 'on', on)
  }
  show(v: boolean): void {
    if (v === this.vis) return
    this.vis = v
    flag(this.g, 'off', !v)
  }
}

class Dot {
  readonly el: SVGCircleElement
  private x = -1e9
  private y = -1e9
  constructor(parent: Element, cls: string, r = 1.6) {
    this.el = svg('circle', { class: cls, r }, parent)
  }
  at(x: number, y: number): void {
    if (Math.abs(x - this.x) > 0.25) this.el.setAttribute('cx', (this.x = x).toFixed(1))
    if (Math.abs(y - this.y) > 0.25) this.el.setAttribute('cy', (this.y = y).toFixed(1))
  }
}

interface Balloon {
  gi: number
  c: Callout
  leader: PolyPath
  dot: Dot
  head: Anchor
  name: Label
  sub: Label
  ay: number
  by: number
  dx: number
  dy: number
  ex: number
  ok: boolean
  hidden: boolean
  thr: number
}

interface XLabel {
  info: NodeInfo
  c: Callout
  leader: PolyPath
  dot: Dot
  name: Label
  sub: Label
  ay: number
  ly: number
  dx: number
  dy: number
  ok: boolean
}

/**
 * The technical-drawing layer: a fixed full-viewport SVG between the canvas
 * and the copy, anchored to the pencil's part nodes every frame.
 *  Detail      — cutting plane B–B on the grip + hatched SECTION B–B inset
 *                with the A/F 7.80 across-flats dimension; Ø 0.50 tip callout
 *  Exploded    — numbered balloons ①–⑨ with leaders, hover/tap highlight,
 *                cursor label `PART 06 · CLUTCH`; giant outlined "9"
 *  X-ray       — accent scan hairline with a live axial station readout;
 *                paper-coloured internals labels developed by the scan
 *  Mechanism   — step counter callout on the clutch (01/05 … 05/05)
 *  Reassembly  — L 136.5 overall-length dimension + centre line, drawn once
 * Plus pencil picking: hover affordance + click → bus 'pencil:click'.
 */
export class OverlayModule implements SceneModule {
  readonly name = 'drawing:overlay'
  private stage: Stage | null = null
  private cam!: THREE.PerspectiveCamera
  private root!: SVGSVGElement
  private clipPaperRect!: SVGRectElement
  private clipInkRect!: SVGRectElement
  private gPaper!: SVGGElement
  private gInk!: SVGGElement
  private gScan!: SVGGElement
  private picker: Picker
  private num: HTMLDivElement | null = null
  private numY = NaN
  private numOp = -1
  private exploded: HTMLElement | null = null

  // scratch (no per-frame allocation)
  private v = new THREE.Vector3()
  private t1 = new THREE.Vector3()
  private t2 = new THREE.Vector3()
  private t3 = new THREE.Vector3()
  private axis = new THREE.Vector3()
  private pA = pt()
  private pB = pt()
  private pC = pt()
  private pD = pt()
  private buf = new Float32Array(32)
  private arr = new Float32Array(8)
  private fr = { ux: 0, uy: 0, r: 0 }
  private frameNo = 0

  // pointer / picking
  private ptrDirty = false
  private lastPickP = -1
  private overUI = false
  private down = { x: 0, y: 0, t: 0, on: false }
  private pendingClick: { x: number; y: number } | null = null
  private cursorKey = 'default|'
  private cursorMine = false
  private cards: HTMLElement[] = []

  // highlight
  private hiGroup = -1
  private hiMeshes: THREE.Mesh[] = []
  private hiMats = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  private hiK = 0

  // sections
  private balloons: Balloon[] = []
  private bracket!: PolyPath
  private bracketC!: Callout
  private xlabels: XLabel[] = []
  private detail!: {
    c: Callout
    chain: PolyPath
    cutA: PolyPath
    cutB: PolyPath
    arrA: PolyPath
    arrB: PolyPath
    bA: Label
    bB: Label
    inset: Anchor
    hatch: PolyPath
    hex: PolyPath
    bore: PolyPath
    clH: PolyPath
    clV: PolyPath
    ext1: PolyPath
    ext2: PolyPath
    dim: PolyPath
    ar1: PolyPath
    ar2: PolyPath
    af: Label
    title: Label
    scale: Label
    tipC: Callout
    tipLeader: PolyPath
    tipDot: Dot
    tipText: Label
  }
  private scan!: {
    line: PolyPath
    tick: Dot
    tickLine: PolyPath
    label: Label
    station: Label
    g: SVGGElement
    vis: boolean
  }
  private mech!: {
    c: Callout
    leader: PolyPath
    dot: Dot
    block: Anchor
    count: Label
    name: Label
    sub: Label
    step: number
  }
  private re!: {
    c: Callout
    inset: Anchor
    outline: PolyPath
    cl: PolyPath
    ext1: PolyPath
    ext2: PolyPath
    dim: PolyPath
    ar1: PolyPath
    ar2: PolyPath
    text: Label
    title: Label
    drawnOnce: boolean
    key: string
  }
  private profile: Profile | null = null
  private clickC!: { c: Callout; leader: PolyPath; text: Label; at: number }
  private nextSlot = 0
  private animUntil = 0
  private lastClickAt = -1

  constructor(private st: DrawingState) {
    this.picker = new Picker(st)
  }

  // ---------------------------------------------------------------- setup
  init(stage: Stage, asm: Assembly): void {
    this.stage = stage
    this.cam = stage.camera
    if (this.st.asm !== asm) this.st.build(asm)
    this.st.motionOK = !document.body.classList.contains('reduced')
    this.buildDom()
    this.measure()
    window.addEventListener('pointermove', this.onMove, { passive: true })
    window.addEventListener('pointerdown', this.onDown, { passive: true })
    window.addEventListener('pointerup', this.onUp, { passive: true })
    window.addEventListener('pointercancel', this.onCancel, { passive: true })
  }

  private buildDom(): void {
    const root = svg('svg', { id: 'drawing', 'aria-hidden': 'true', focusable: 'false' })
    document.body.appendChild(root)
    this.root = root
    const defs = svg('defs', {}, root)
    const pat = svg('pattern', {
      id: 'dr-hatch',
      width: 4,
      height: 4,
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)',
    }, defs)
    svg('path', { d: 'M0 0V4', class: 'dr-hatchline' }, pat)
    const cp = svg('clipPath', { id: 'dr-clip-paper' }, defs)
    this.clipPaperRect = svg('rect', { x: -10, y: 0, width: 10000, height: 10000 }, cp)
    const ci = svg('clipPath', { id: 'dr-clip-ink' }, defs)
    this.clipInkRect = svg('rect', { x: -10, y: 0, width: 10000, height: 0 }, ci)
    this.gPaper = svg('g', { class: 'dr-paper' }, root)
    this.gInk = svg('g', { class: 'dr-inkzone', 'clip-path': 'url(#dr-clip-ink)' }, root)
    this.gScan = svg('g', { class: 'dr-scan' }, root)

    // ---- detail
    {
      const c = new Callout(this.gPaper, 'dr-detail')
      const g = c.g
      const inset = new Anchor(g, 'dr-inset')
      const ig = inset.el
      const tipC = new Callout(this.gPaper, 'dr-tip')
      this.detail = {
        c,
        chain: new PolyPath(g, 'df cl', false),
        cutA: new PolyPath(g, 'dl thick'),
        cutB: new PolyPath(g, 'dl thick'),
        arrA: new PolyPath(g, 'df fill', false),
        arrB: new PolyPath(g, 'df fill', false),
        bA: new Label(g, 'df dr-letter halo', 'B'),
        bB: new Label(g, 'df dr-letter halo', 'B'),
        inset,
        hatch: new PolyPath(ig, 'df dr-hatch', false),
        hex: new PolyPath(ig, 'dl strong'),
        bore: new PolyPath(ig, 'dl'),
        clH: new PolyPath(ig, 'df cl', false),
        clV: new PolyPath(ig, 'df cl', false),
        ext1: new PolyPath(ig, 'dl'),
        ext2: new PolyPath(ig, 'dl'),
        dim: new PolyPath(ig, 'dl'),
        ar1: new PolyPath(ig, 'df fill', false),
        ar2: new PolyPath(ig, 'df fill', false),
        af: new Label(ig, 'df dr-val halo', DIM.acrossFlats),
        title: new Label(ig, 'df dr-title', DIM.sectionGrip),
        scale: new Label(ig, 'df dr-sub', DIM.sectionScale),
        tipC,
        tipLeader: new PolyPath(tipC.g, 'dl'),
        tipDot: new Dot(tipC.g, 'df dr-dot'),
        tipText: new Label(tipC.g, 'df dr-val halo', DIM.lead),
      }
    }

    // ---- exploded balloons
    this.bracketC = new Callout(this.gPaper, 'dr-bracket')
    this.bracket = new PolyPath(this.bracketC.g, 'acc', false)
    this.st.groups.forEach((gr) => {
      const c = new Callout(this.gPaper, 'dr-balloon')
      const leader = new PolyPath(c.g, 'dl')
      const dot = new Dot(c.g, 'df dr-dot')
      const head = new Anchor(c.g, 'dr-head')
      const ring = new PolyPath(head.el, 'dl dr-ring')
      ring.raw('M-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0')
      const numL = new Label(head.el, 'df dr-num', String(gr.def.n))
      numL.at(0, 3.5, 'middle')
      const name = new Label(head.el, 'dr-name halo', gr.def.name.toUpperCase())
      const sub = new Label(head.el, 'dr-name dr-sub halo', gr.def.sub.toUpperCase())
      this.balloons.push({
        gi: gr.index, c, leader, dot, head, name, sub,
        ay: 0, by: 0, dx: 0, dy: 0, ex: 0, ok: false, hidden: false, thr: 0,
      })
    })

    // ---- x-ray labels (paper on ink)
    for (const def of XRAY_LABELS) {
      const info = this.st.byName.get(def.node)
      if (!info) continue
      const c = new Callout(this.gInk, 'dr-xl')
      c.g.dataset.mobile = String(def.mobile)
      this.xlabels.push({
        info,
        c,
        leader: new PolyPath(c.g, 'dl'),
        dot: new Dot(c.g, 'df dr-dot'),
        name: new Label(c.g, 'df dr-xname', def.text.toUpperCase()),
        sub: new Label(c.g, 'df dr-sub', def.sub.toUpperCase()),
        ay: 0, ly: 0, dx: 0, dy: 0, ok: false,
      })
    }

    // ---- scan line
    {
      const g = svg('g', { class: 'dr-scanline off' }, this.gScan)
      this.scan = {
        g,
        line: new PolyPath(g, 'scan', false),
        tickLine: new PolyPath(g, 'scan', false),
        tick: new Dot(g, 'scan-dot', 3),
        label: new Label(g, 'scan-label', 'SECTION A–A'),
        station: new Label(g, 'scan-label', ''),
        vis: false,
      }
    }

    // ---- mechanism
    {
      const c = new Callout(this.gPaper, 'dr-mech')
      const block = new Anchor(c.g)
      this.mech = {
        c,
        leader: new PolyPath(c.g, 'dl'),
        dot: new Dot(c.g, 'df dr-dot'),
        block,
        count: new Label(block.el, 'df dr-count halo', ''),
        name: new Label(block.el, 'df dr-title halo', ''),
        sub: new Label(block.el, 'df dr-sub halo', ''),
        step: -1,
      }
      this.mech.count.at(0, -2)
      this.mech.name.at(0, 14)
      this.mech.sub.at(0, 27)
    }

    // ---- reassembly: side elevation + L 136.5 (camera-independent inset)
    {
      const c = new Callout(this.gPaper, 'dr-re')
      const inset = new Anchor(c.g)
      const g = inset.el
      this.re = {
        c,
        inset,
        cl: new PolyPath(g, 'df cl', false),
        outline: new PolyPath(g, 'dl strong dr-elev'),
        ext1: new PolyPath(g, 'dl'),
        ext2: new PolyPath(g, 'dl'),
        dim: new PolyPath(g, 'dl'),
        ar1: new PolyPath(g, 'df fill', false),
        ar2: new PolyPath(g, 'df fill', false),
        text: new Label(g, 'df dr-val dr-big halo', DIM.length),
        title: new Label(g, 'df dr-sub', 'SIDE ELEV. · NTS'),
        drawnOnce: false,
        key: '',
      }
    }

    // ---- click feedback (+0.5 at the tip)
    {
      const c = new Callout(this.gPaper, 'dr-click')
      this.clickC = { c, leader: new PolyPath(c.g, 'dl'), text: new Label(c.g, 'df dr-val halo', '+0.5'), at: -1 }
    }

    // ---- giant outlined numeral (behind the canvas, before the ink sheet)
    const num = document.createElement('div')
    num.id = 'dr-num'
    num.setAttribute('aria-hidden', 'true')
    num.textContent = '9'
    document.body.insertBefore(num, document.body.firstChild)
    this.num = num
  }

  private measure(): void {
    const stage = this.stage
    if (!stage) return
    const r = stage.renderer.domElement.getBoundingClientRect()
    const vp = this.st.vp
    vp.w = Math.max(1, r.width || window.innerWidth)
    vp.h = Math.max(1, r.height || window.innerHeight)
    vp.left = r.left
    vp.top = r.top
    vp.dpr = stage.renderer.getPixelRatio()
    vp.small = window.innerWidth <= 900
    flag(this.root, 'is-small', vp.small)
    this.cards = [...document.querySelectorAll<HTMLElement>('main .card')]
    this.exploded = document.getElementById('exploded')
    this.ptrDirty = true
  }

  onResize(): void {
    this.measure()
  }

  onMotionChange(ok: boolean): void {
    this.st.motionOK = ok
  }

  wantsFrame(): boolean {
    return this.ptrDirty || this.pendingClick !== null || performance.now() < this.animUntil
  }

  // ---------------------------------------------------------------- pointer
  private onMove = (e: PointerEvent): void => {
    const t = e.target as Element | null
    this.overUI = !!t?.closest?.(UI_SEL)
    this.ptrDirty = true
  }
  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), on: true }
  }
  private onUp = (e: PointerEvent): void => {
    if (!this.down.on) return
    this.down.on = false
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) return
    if (performance.now() - this.down.t > 600) return
    const t = e.target as Element | null
    if (t?.closest?.(UI_SEL)) return
    for (const c of this.cards) {
      const r = c.getBoundingClientRect()
      if (r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return
    }
    this.pendingClick = { x: e.clientX, y: e.clientY }
  }
  private onCancel = (): void => {
    this.down.on = false
  }

  private setCursor(mode: CursorMode, label = ''): void {
    const key = `${mode}|${label}`
    if (key === this.cursorKey) return
    this.cursorKey = key
    if (mode === 'default') {
      if (!this.cursorMine) return
      this.cursorMine = false
      bus.emit('cursor', { mode })
      return
    }
    this.cursorMine = true
    bus.emit('cursor', label ? { mode, label } : { mode })
  }

  /** zone for picking: parts (exploded), pencil (click), none */
  private zone(p: number, ex: number): 'parts' | 'pencil' | 'none' {
    if (ex > 0.5 && p < SCAN.inA) return 'parts'
    if (p < 0.15 || (p > SCAN.inB && p < 0.6)) return 'pencil'
    return 'none'
  }

  private balloonAt(x: number, y: number): number {
    const r = this.st.vp.small ? 24 : 15
    for (const b of this.balloons) {
      if (!b.c.on || !b.c.vis) continue
      if (Math.hypot(x - b.dx, y - b.by) <= r) return b.gi
    }
    return -1
  }

  private handlePointer(p: number, ex: number): void {
    const st = this.st
    const zone = this.zone(p, ex)
    const moved = this.ptrDirty || Math.abs(p - this.lastPickP) > 0.002
    if (this.pendingClick) {
      const { x, y } = this.pendingClick
      this.pendingClick = null
      if (zone === 'parts') {
        let g = this.balloonAt(x, y)
        if (g < 0) g = this.picker.pick(this.cam, x, y)
        st.pinned = g >= 0 && g !== st.pinned ? g : -1
      } else if (zone === 'pencil') {
        if (this.picker.pick(this.cam, x, y) !== -1) bus.emit('pencil:click', {})
      }
    }
    if (zone !== 'parts') {
      st.pinned = -1
      st.hover = -1
    }
    if (!moved) return
    this.ptrDirty = false
    this.lastPickP = p
    const usable = pointer.active && !pointer.coarse && !this.overUI
    if (!usable || zone === 'none') {
      st.hover = -1
      this.setCursor('default')
      return
    }
    if (zone === 'parts') {
      let g = this.balloonAt(pointer.x, pointer.y)
      if (g < 0) g = this.picker.pick(this.cam, pointer.x, pointer.y)
      st.hover = g >= 0 ? g : -1
      if (st.hover >= 0) this.setCursor('hover', cursorLabel(st.groups[st.hover].def))
      else this.setCursor('default')
      return
    }
    st.hover = -1
    const hit = this.picker.pick(this.cam, pointer.x, pointer.y) !== -1
    this.setCursor(hit ? 'view' : 'default', hit ? 'CLICK' : '')
  }

  // ---------------------------------------------------------------- highlight
  private setHighlight(gi: number): void {
    if (gi === this.hiGroup) return
    for (const m of this.hiMeshes) {
      const orig = m.userData.drOrig as THREE.Material | undefined
      if (orig) m.material = orig
      delete m.userData.drOrig
    }
    this.hiMeshes.length = 0
    this.hiGroup = gi
    this.hiK = 0
    if (gi < 0) return
    for (const m of this.st.groups[gi].meshes) {
      const src = m.material as THREE.MeshStandardMaterial
      if (Array.isArray(src) || !src || !('emissive' in src)) continue
      let hi = this.hiMats.get(src)
      if (!hi) {
        hi = src.clone()
        this.hiMats.set(src, hi)
      }
      m.userData.drOrig = src
      m.material = hi
      this.hiMeshes.push(m)
    }
  }

  private animateHighlight(dt: number): void {
    if (this.hiGroup < 0) return
    this.hiK += (1 - this.hiK) * (this.st.motionOK ? 1 - Math.exp(-16 * dt) : 1)
    for (const m of this.hiMeshes) {
      const src = m.userData.drOrig as THREE.MeshStandardMaterial
      const hi = m.material as THREE.MeshStandardMaterial
      hi.color.copy(src.color)
      hi.emissive.copy(ACCENT).multiplyScalar(0.55 * this.hiK)
    }
    if (this.hiK < 0.995) this.animUntil = performance.now() + 50
  }

  // ---------------------------------------------------------------- geometry
  private proj(world: THREE.Vector3, out: Pt): Pt {
    const vp = this.st.vp
    this.v.copy(world).project(this.cam)
    out.x = vp.left + (this.v.x * 0.5 + 0.5) * vp.w
    out.y = vp.top + (-this.v.y * 0.5 + 0.5) * vp.h
    out.ok = this.v.z > -1 && this.v.z < 1
    return out
  }

  private onScreen(q: Pt, m = 0): boolean {
    const vp = this.st.vp
    return q.ok && q.x > vp.left - m && q.x < vp.left + vp.w + m && q.y > vp.top - m && q.y < vp.top + vp.h + m
  }

  /** world point of node-local (0, y, 0) → out */
  private axisPt(info: NodeInfo, y: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, y, 0).applyMatrix4(info.node.matrixWorld)
  }

  /**
   * Screen frame of a node at local height y: centre (into a), unit axis
   * (ax, ay) pointing toward -Y (down the pencil) and silhouette radius px.
   */
  private frame(info: NodeInfo, y: number, rLocal: number, a: Pt): { ux: number; uy: number; r: number } {
    const fr = this.fr
    this.axisPt(info, y, this.t1)
    this.proj(this.t1, a)
    this.axis.setFromMatrixColumn(info.node.matrixWorld, 1)
    const scale = this.axis.length()
    this.axis.divideScalar(scale || 1)
    this.t2.copy(this.t1).addScaledVector(this.axis, -0.5)
    this.proj(this.t2, this.pD)
    let ux = this.pD.x - a.x
    let uy = this.pD.y - a.y
    const l = Math.hypot(ux, uy) || 1
    ux /= l
    uy /= l
    // radius: perpendicular to axis and view ray
    this.t3.subVectors(this.t1, this.cam.position).normalize()
    this.t2.crossVectors(this.axis, this.t3).normalize()
    this.t3.copy(this.t1).addScaledVector(this.t2, rLocal * scale)
    this.proj(this.t3, this.pD)
    fr.ux = ux
    fr.uy = uy
    fr.r = Math.hypot(this.pD.x - a.x, this.pD.y - a.y)
    return fr
  }

  // ---------------------------------------------------------------- frame
  update(ctx: FrameCtx): void {
    const st = this.st
    const stage = this.stage
    if (!stage) return
    st.motionOK = ctx.motionOK
    const p = ctx.p
    const ex = explodeF(p)
    this.frameNo++
    stage.scene.updateMatrixWorld()
    this.cam.updateMatrixWorld()

    this.handlePointer(p, ex)
    const active = st.hover >= 0 ? st.hover : st.pinned
    this.setHighlight(active)
    this.animateHighlight(ctx.dt)

    // ink / paper clip rects for the overlay layers
    const inkOn = st.inkAlpha > 0.001 && st.inkBot > st.inkTop
    if (inkOn) {
      this.clipInkRect.setAttribute('y', st.inkTop.toFixed(1))
      this.clipInkRect.setAttribute('height', (st.inkBot - st.inkTop).toFixed(1))
      this.clipPaperRect.setAttribute('y', st.inkBot.toFixed(1))
      if (!this.gPaper.hasAttribute('clip-path')) this.gPaper.setAttribute('clip-path', 'url(#dr-clip-paper)')
    } else if (this.gPaper.hasAttribute('clip-path')) {
      this.gPaper.removeAttribute('clip-path')
      this.clipInkRect.setAttribute('height', '0')
    }

    this.updateDetail(p)
    this.updateBalloons(p, ex, active)
    this.updateXray(p)
    this.updateScan()
    this.updateMech(p)
    this.updateReassembly(p)
    this.updateClick()
    this.updateNumeral(ex)
  }

  private cardRects: DOMRect[] = []
  private cardFrame = -1

  /** true if a screen rect would sit on top of copy (cards are above us) */
  private blocked(x0: number, y0: number, x1: number, y1: number): boolean {
    if (this.cardFrame !== this.frameNo) {
      this.cardFrame = this.frameNo
      this.cardRects.length = 0
      const h = this.st.vp.h
      for (const c of this.cards) {
        const r = c.getBoundingClientRect()
        if (r.width > 0 && r.bottom > 0 && r.top < h) this.cardRects.push(r)
      }
    }
    for (const r of this.cardRects) {
      if (x1 > r.left - 10 && x0 < r.right + 10 && y1 > r.top - 10 && y0 < r.bottom + 10) return true
    }
    return false
  }

  private anyOn(list: { c: Callout }[]): boolean {
    for (const x of list) if (x.c.on) return true
    return false
  }

  private schedule(c: Callout, on: boolean): void {
    if (on === c.on) return
    if (!on) return c.set(false)
    const now = performance.now()
    const delay = this.st.motionOK ? Math.max(0, this.nextSlot - now) : 0
    this.nextSlot = now + delay + 60
    c.set(true, delay)
  }

  // ---- detail: cutting plane B–B, section inset, A/F, Ø tip -------------
  private updateDetail(p: number): void {
    const d = this.detail
    const st = this.st
    const grip = st.byName.get('grip')
    const on = DETAIL_ON(p) && !!grip
    if (!grip) {
      d.c.set(false)
      d.tipC.set(false)
      return
    }
    if (!on && !TIP_ON(p) && !d.c.on && !d.tipC.on) return
    const vp = st.vp
    const small = vp.small
    // station: low on the grip, toward the nose (clear of the copy)
    const y = grip.center.y - grip.size.y * 0.22
    const rLocal = Math.max(grip.size.x, grip.size.z) / 2
    const S = this.pA
    const f = this.frame(grip, y, rLocal, S)
    let nx = -f.uy
    let ny = f.ux
    if (nx < 0) {
      nx = -nx
      ny = -ny
    }
    const vis = on && this.onScreen(S, -20)
    d.c.show(vis)
    this.schedule(d.c, vis)
    if (vis) {
      const b = this.buf
      const r0 = f.r + 8
      const r1 = f.r + (small ? 30 : 40)
      // cutting-plane line ends (thick), arrows show the viewing direction
      b[0] = S.x + nx * r0; b[1] = S.y + ny * r0; b[2] = S.x + nx * r1; b[3] = S.y + ny * r1
      d.cutA.set(b, 4)
      b[0] = S.x - nx * r0; b[1] = S.y - ny * r0; b[2] = S.x - nx * r1; b[3] = S.y - ny * r1
      d.cutB.set(b, 4)
      b[0] = S.x + nx * r1; b[1] = S.y + ny * r1; b[2] = S.x - nx * r1; b[3] = S.y - ny * r1
      d.chain.set(b, 4)
      const al = 12
      const ax = -f.ux
      const ay = -f.uy
      const ex1 = S.x + nx * r1
      const ey1 = S.y + ny * r1
      const ex2 = S.x - nx * r1
      const ey2 = S.y - ny * r1
      d.arrA.set(this.arr, arrowPts(this.arr, ex1 + ax * al, ey1 + ay * al, ax, ay, 7, 2.4), true)
      d.arrB.set(this.arr, arrowPts(this.arr, ex2 + ax * al, ey2 + ay * al, ax, ay, 7, 2.4), true)
      d.bA.at(ex1 + ax * (al + 12) + nx * 2, ey1 + ay * (al + 12) + ny * 2 + 4, 'middle')
      d.bB.at(ex2 + ax * (al + 12) - nx * 2, ey2 + ay * (al + 12) - ny * 2 + 4, 'middle')

      // section inset
      const R = small ? 32 : 54
      let cx = S.x + nx * (r1 + (small ? 70 : 150))
      let cy = S.y + ny * (r1 + (small ? 70 : 150)) + (small ? 0 : 30)
      const m = R + 70
      cx = Math.min(vp.left + vp.w - m, Math.max(vp.left + m, cx))
      cy = Math.min(vp.top + vp.h - m - 20, Math.max(vp.top + m + 40, cy))
      d.inset.at(cx, cy)
      // hex orientation as seen down the axis (corner direction = local X)
      this.t1.setFromMatrixColumn(grip.node.matrixWorld, 0).normalize()
      this.t3.subVectors(this.cam.position, this.v.set(0, 0, 0).applyMatrix4(grip.node.matrixWorld)).normalize()
      this.t2.crossVectors(this.axis, this.t3).normalize() // screen-right-ish, ⟂ axis
      const th = Math.atan2(-this.t1.dot(this.t3), this.t1.dot(this.t2))
      const hb = this.buf
      for (let k = 0; k < 6; k++) {
        const a = th + (k * Math.PI) / 3
        hb[k * 2] = Math.cos(a) * R
        hb[k * 2 + 1] = Math.sin(a) * R
      }
      d.hex.set(hb, 12, true)
      const rb = R * 0.46
      let hd = `M${hb[0].toFixed(1)} ${hb[1].toFixed(1)}`
      for (let k = 1; k < 6; k++) hd += `L${hb[k * 2].toFixed(1)} ${hb[k * 2 + 1].toFixed(1)}`
      hd += `ZM${-rb} 0a${rb} ${rb} 0 1 0 ${2 * rb} 0a${rb} ${rb} 0 1 0 ${-2 * rb} 0Z`
      d.hatch.raw(hd)
      d.bore.raw(`M${-rb} 0a${rb} ${rb} 0 1 0 ${2 * rb} 0a${rb} ${rb} 0 1 0 ${-2 * rb} 0`)
      b[0] = -R - 10; b[1] = 0; b[2] = R + 10; b[3] = 0
      d.clH.set(b, 4)
      b[0] = 0; b[1] = -R - 10; b[2] = 0; b[3] = R + 10
      d.clV.set(b, 4)
      // A/F: flat pair whose outward tangent points most nearly up
      const af = R * Math.cos(Math.PI / 6)
      let best = 0
      let bestY = Infinity
      for (let k = 0; k < 6; k++) {
        const phi = th + Math.PI / 6 + (k * Math.PI) / 3 // flat normal
        const ty = Math.sin(phi + Math.PI / 2)
        if (ty < bestY) {
          bestY = ty
          best = phi
        }
      }
      // m: flat normal, t: tangent pointing up (a corner direction → extent R)
      const mx = Math.cos(best)
      const my = Math.sin(best)
      const tx = Math.cos(best + Math.PI / 2)
      const ty = Math.sin(best + Math.PI / 2)
      const e0 = R * 0.5 + 4
      const e1 = R + 18
      const dd = R + 11
      b[0] = mx * af + tx * e0; b[1] = my * af + ty * e0; b[2] = mx * af + tx * e1; b[3] = my * af + ty * e1
      d.ext1.set(b, 4)
      b[0] = -mx * af + tx * e0; b[1] = -my * af + ty * e0; b[2] = -mx * af + tx * e1; b[3] = -my * af + ty * e1
      d.ext2.set(b, 4)
      b[0] = mx * af + tx * dd; b[1] = my * af + ty * dd; b[2] = -mx * af + tx * dd; b[3] = -my * af + ty * dd
      d.dim.set(b, 4)
      d.ar1.set(this.arr, arrowPts(this.arr, b[0], b[1], mx, my, 7, 2.3), true)
      d.ar2.set(this.arr, arrowPts(this.arr, b[2], b[3], -mx, -my, 7, 2.3), true)
      d.af.at(tx * (dd + 15), ty * (dd + 15) + 3.5, 'middle')
      d.title.at(0, R + 30, 'middle')
      d.scale.at(0, R + 44, 'middle')
    }

    // Ø 0.50 on the lead path: the tip if it is in frame, else the lowest
    // visible point of the lead / sleeve (the macro often crops the tip)
    const lead = st.byName.get('lead')
    const sleeve = st.byName.get('leadSleeve')
    if (lead || sleeve) {
      let found = false
      for (let k = 0; k < 8 && !found; k++) {
        const info = k < 4 ? (lead ?? sleeve)! : (sleeve ?? lead)!
        const f = (k % 4) / 3
        // the lead runs up inside the body: only its first ~1.7 mm (past the
        // sleeve) is visible, so only sample that stretch of it
        const span = info === lead ? Math.min(0.17, info.box.max.y - info.box.min.y) : (info.box.max.y - info.box.min.y) * 0.92
        const y = info.box.min.y + span * f
        this.axisPt(info, y, this.t1)
        this.proj(this.t1, this.pB)
        found = this.onScreen(this.pB, -40)
      }
      let placed = false
      if (TIP_ON(p) && found) {
        // keep the value clear of the copy: try both sides, then a longer shoulder
        const pref = this.pB.x < vp.left + vp.w * 0.62 ? 1 : -1
        const tw = small ? 88 : 100
        const x = this.pB.x
        const y = this.pB.y
        for (let s = 0; s < 2 && !placed; s++) {
          const side = s === 0 ? pref : -pref
          for (let e = 0; e < 4 && !placed; e++) {
            const sh = (small ? 60 : 78) + e * 70
            const ex = x + side * sh
            const tx0 = side > 0 ? ex + 6 : ex - 6 - tw
            if (tx0 < vp.left + 8 || tx0 + tw > vp.left + vp.w - 8) continue
            if (this.blocked(tx0, y - 46, tx0 + tw, y - 26)) continue
            const b = this.buf
            b[0] = x; b[1] = y
            b[2] = x + side * 34; b[3] = y - 34
            b[4] = ex; b[5] = y - 34
            d.tipLeader.set(b, 6)
            d.tipDot.at(x, y)
            d.tipText.at(ex + side * 6, y - 30.5, side > 0 ? 'start' : 'end')
            placed = true
          }
        }
      }
      d.tipC.show(placed)
      this.schedule(d.tipC, placed)
    }
  }

  // ---- exploded: balloons ①–⑨ ---------------------------------------------
  private updateBalloons(p: number, ex: number, active: number): void {
    const st = this.st
    const vp = st.vp
    const small = vp.small
    const live = ex > 0.25 && p < SCAN.inB
    if (!live && !this.anyOn(this.balloons)) {
      this.bracketC.set(false)
      return
    }
    let sumX = 0
    let cnt = 0
    let maxR = 0
    for (const b of this.balloons) {
      const gr = st.groups[b.gi]
      if (small && !gr.def.mobile) {
        b.ok = false
        continue
      }
      const info = gr.anchor
      const f = this.frame(info, info.center.y, info.radius, this.pA)
      b.ok = this.onScreen(this.pA, -8)
      b.ay = this.pA.y
      let nx = -f.uy
      let ny = f.ux
      if (nx < 0) {
        nx = -nx
        ny = -ny
      }
      b.dx = this.pA.x + nx * f.r * 0.5
      b.dy = this.pA.y + ny * f.r * 0.5
      b.ex = this.pA.x
      if (b.ok) {
        sumX += this.pA.x
        cnt++
        maxR = Math.max(maxR, f.r)
      }
    }
    const axisX = cnt ? sumX / cnt : vp.left + vp.w / 2
    let side = 1
    const colOff = maxR + (small ? 46 : 86)
    if (axisX + colOff + (small ? 40 : 170) > vp.left + vp.w) side = -1
    const colX = axisX + side * colOff
    const elbowX = axisX + side * (maxR + (small ? 14 : 22))
    // vertical relaxation (keep order, min gap)
    const gap = small ? 34 : 28
    const top = vp.top + 84
    const bot = vp.top + vp.h - 24
    let prev = -Infinity
    const list = this.balloons
    for (const b of list) {
      if (!b.ok) continue
      b.by = Math.max(b.ay, prev + gap, top)
      prev = b.by
    }
    let next = Infinity
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]
      if (!b.ok) continue
      b.by = Math.min(b.by, next - gap, bot)
      next = b.by
    }
    // occlusion: leader lands on a part hidden behind another (e.g. inside the hull)
    const checkOcc = this.frameNo % 6 === 1
    let rank = 0
    for (const b of list) {
      b.thr = 0.32 + 0.055 * rank
      rank++
      const want = live && b.ok && ex > (b.c.on ? b.thr - 0.06 : b.thr)
      b.c.show(b.ok)
      this.schedule(b.c, want)
      if (!b.ok || !(want || b.c.on)) continue
      if (checkOcc) {
        const g = this.picker.pick(this.cam, b.dx, b.dy)
        b.hidden = g !== b.gi
        flag(b.c.g, 'hid', b.hidden)
      }
      const buf = this.buf
      buf[0] = b.dx; buf[1] = b.dy
      buf[2] = elbowX; buf[3] = b.by
      buf[4] = colX - side * 9; buf[5] = b.by
      b.leader.set(buf, 6)
      b.dot.at(b.dx, b.dy)
      b.head.at(colX, b.by)
      b.name.at(side * 16, -1, side > 0 ? 'start' : 'end')
      b.sub.at(side * 16, 11, side > 0 ? 'start' : 'end')
      flag(b.c.g, 'act', b.gi === active)
    }
    // hairline bracket around the active part
    if (active >= 0 && live) {
      const gr = st.groups[active]
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const n of gr.nodes) {
        const bx = n.box
        for (let k = 0; k < 8; k++) {
          this.t1.set(k & 1 ? bx.max.x : bx.min.x, k & 2 ? bx.max.y : bx.min.y, k & 4 ? bx.max.z : bx.min.z)
          this.t1.applyMatrix4(n.node.matrixWorld)
          this.proj(this.t1, this.pC)
          x0 = Math.min(x0, this.pC.x); x1 = Math.max(x1, this.pC.x)
          y0 = Math.min(y0, this.pC.y); y1 = Math.max(y1, this.pC.y)
        }
      }
      const pad = 7
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
      const k = Math.min(10, (x1 - x0) / 3, (y1 - y0) / 3)
      const f = (v: number): string => v.toFixed(1)
      this.bracket.raw(
        `M${f(x0)} ${f(y0 + k)}V${f(y0)}H${f(x0 + k)}M${f(x1 - k)} ${f(y0)}H${f(x1)}V${f(y0 + k)}` +
          `M${f(x1)} ${f(y1 - k)}V${f(y1)}H${f(x1 - k)}M${f(x0 + k)} ${f(y1)}H${f(x0)}V${f(y1 - k)}`,
      )
      this.bracketC.set(true)
    } else this.bracketC.set(false)
  }

  // ---- x-ray: internals developed by the scan (paper on ink) ---------------
  private updateXray(p: number): void {
    const st = this.st
    const vp = st.vp
    const small = vp.small
    const live = st.inkAlpha > 0.001 && st.inkBot > st.inkTop && p < SCAN.outB && st.mode !== 'off'
    if (!live && !this.anyOn(this.xlabels)) return
    let minX = Infinity
    let maxR = 0
    for (const l of this.xlabels) {
      if (small && l.c.g.dataset.mobile !== 'true') {
        l.ok = false
        continue
      }
      const f = this.frame(l.info, l.info.center.y, l.info.radius, this.pA)
      l.ok = this.onScreen(this.pA, -10)
      l.ay = this.pA.y
      let nx = -f.uy
      let ny = f.ux
      if (nx > 0) {
        nx = -nx
        ny = -ny
      }
      l.dx = this.pA.x + nx * f.r * 0.45
      l.dy = this.pA.y + ny * f.r * 0.45
      if (l.ok) {
        minX = Math.min(minX, this.pA.x)
        maxR = Math.max(maxR, f.r)
      }
    }
    const colX = Math.max(vp.left + (small ? 96 : 150), minX - maxR - (small ? 40 : 76))
    const elbowX = minX - maxR - (small ? 10 : 18)
    const gap = 34
    let prev = -Infinity
    for (const l of this.xlabels) {
      if (!l.ok) continue
      l.ly = Math.max(l.ay, prev + gap)
      prev = l.ly
    }
    for (const l of this.xlabels) {
      const developed = live && l.ok && l.ay > st.inkTop + 8 && l.ay < st.inkBot - 10
      l.c.show(l.ok)
      this.schedule(l.c, developed)
      if (!l.ok || !(developed || l.c.on)) continue
      const b = this.buf
      b[0] = l.dx; b[1] = l.dy
      b[2] = elbowX; b[3] = l.ly
      b[4] = colX + 6; b[5] = l.ly
      l.leader.set(b, 6)
      l.dot.at(l.dx, l.dy)
      l.name.at(colX, l.ly - 2, 'end')
      l.sub.at(colX, l.ly + 10, 'end')
    }
  }

  // ---- scan hairline + axial station readout -------------------------------
  private updateScan(): void {
    const st = this.st
    const s = this.scan
    const y = st.lineY
    const vp = st.vp
    const vis = Number.isFinite(y) && y > vp.top - 2 && y < vp.top + vp.h + 2
    if (vis !== s.vis) {
      s.vis = vis
      flag(s.g, 'off', !vis)
    }
    if (!vis) return
    const b = this.buf
    b[0] = vp.left; b[1] = y; b[2] = vp.left + vp.w; b[3] = y
    s.line.set(b, 4)
    // pencil axis: button top → lead tip (current, possibly exploded) positions
    const topN = st.byName.get('cap') ?? st.nodes[0]
    const botN = st.byName.get('lead') ?? st.nodes[st.nodes.length - 1]
    this.proj(this.axisPt(topN, topN.box.max.y, this.t1), this.pA)
    this.proj(this.axisPt(botN, botN.box.min.y, this.t2), this.pB)
    const inkAbove = st.inkBot >= y - 1 && st.inkAlpha > 0.5
    flag(s.g, 'neg', inkAbove)
    // readouts would collide with the top bar / bottom edge
    flag(s.g, 'quiet', y < vp.top + 116 || y > vp.top + vp.h - 28)
    const ly = inkAbove ? y - 8 : y + 15
    s.label.at(vp.left + (vp.small ? 16 : 28), ly, 'start')
    const span = this.pB.y - this.pA.y
    if (Math.abs(span) > 1 && (y - this.pA.y) / span >= 0 && (y - this.pA.y) / span <= 1) {
      const t = (y - this.pA.y) / span
      const x = this.pA.x + (this.pB.x - this.pA.x) * t
      s.tick.at(x, y)
      b[0] = x; b[1] = y - 9; b[2] = x; b[3] = y + 9
      s.tickLine.set(b, 4)
      const topY = topN.node.position.y + topN.box.max.y * topN.node.scale.y
      const botY = botN.node.position.y + botN.box.min.y * botN.node.scale.y
      const mm = t * (topY - botY) * 10
      s.station.text(`Y ${mm.toFixed(1).padStart(5, '0')} MM`)
      flag(s.tick.el, 'off', false)
    } else {
      s.station.text('')
      flag(s.tick.el, 'off', true)
    }
    s.station.at(vp.left + vp.w - (vp.small ? 16 : 28), ly, 'end')
  }

  // ---- mechanism: step counter callout on the clutch ------------------------
  private updateMech(p: number): void {
    const st = this.st
    const m = this.mech
    const mc = mechF(p)
    const on = mc > 0.3 && st.step >= 1
    if (!on && !m.c.on) return
    const clutch = st.byName.get('clutch') ?? st.groups.find((g) => g.def.n === 6)?.anchor
    if (!clutch) return
    const f = this.frame(clutch, clutch.center.y, clutch.radius, this.pA)
    const vis = this.onScreen(this.pA, -10)
    m.c.show(vis)
    this.schedule(m.c, on && vis)
    if (!vis) return
    const vp = st.vp
    let nx = -f.uy
    let ny = f.ux
    if (nx < 0) {
      nx = -nx
      ny = -ny
    }
    const fr = f.r
    const cx = this.pA.x
    const cy = this.pA.y
    const bw = vp.small ? 104 : 150
    let side = 1
    let ex = 0
    let ey = 0
    let sx = 0
    for (let s = 0; s < 2; s++) {
      side = s === 0 ? 1 : -1
      ex = cx + side * nx * (fr + 40)
      ey = cy + ny * (fr + 40) - 36
      sx = ex + side * (vp.small ? 28 : 54)
      sx = Math.min(vp.left + vp.w - bw - 12, Math.max(vp.left + bw + 12, sx))
      const x0 = side > 0 ? sx : sx - bw
      if (!this.blocked(x0, ey - 22, x0 + bw, ey + 32)) break
    }
    const dx = cx + side * nx * fr * 0.6
    const dy = cy + ny * fr * 0.6
    const b = this.buf
    b[0] = dx; b[1] = dy; b[2] = ex; b[3] = ey; b[4] = sx; b[5] = ey
    m.leader.set(b, 6)
    m.dot.at(dx, dy)
    m.block.at(sx + side * 8, ey)
    const anchor = side > 0 ? 'start' : 'end'
    m.count.at(0, -2, anchor)
    m.name.at(0, 14, anchor)
    m.sub.at(0, 27, anchor)
    if (st.step >= 1 && st.step !== m.step) {
      m.step = st.step
      const s = MECH_STEPS[st.step - 1]
      m.count.text(`${pad2(st.step)} / 05`)
      m.name.text(s.h.toUpperCase())
      m.sub.text(s.d.toUpperCase())
      if (st.motionOK && m.c.on) {
        for (const el of [m.count.el, m.name.el, m.sub.el]) {
          el.animate(
            [{ transform: 'translateY(7px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: 360, easing: 'cubic-bezier(0.16,1,0.3,1)' },
          )
        }
      }
    }
  }

  // ---- reassembly: side elevation + L 136.5, drawn once -------------------
  // The reassembly camera is a close-up (both ends of the pencil are out of
  // frame), so the overall length lives on a drawn elevation in the margin,
  // sliced from the real meshes at load (see profile.ts).
  private updateReassembly(p: number): void {
    const r = this.re
    const on = REASSEMBLY_ON(p)
    if (!on && !r.c.on) return
    if (!this.profile) this.profile = buildProfile(this.st)
    const pr = this.profile
    if (!pr) return
    const vp = this.st.vp
    const small = vp.small
    const span = pr.yTop - pr.yBot
    const hs = Math.min(vp.h * (small ? 0.46 : 0.6), 520)
    const k = hs / span
    const margin = (vp.w - Math.min(vp.w, 1200)) / 2
    const cx = margin >= 96 ? vp.left + vp.w - margin / 2 + 14 : vp.left + vp.w - (small ? 22 : 40)
    const top = vp.top + (vp.h - hs) / 2
    r.inset.at(cx, top)
    const key = `${vp.w}|${vp.h}`
    if (key !== r.key) {
      r.key = key
      const out = new Float32Array(pr.count)
      for (let i = 0; i < pr.count; i += 2) {
        out[i] = pr.pts[i] * k
        out[i + 1] = (pr.yTop - pr.pts[i + 1]) * k
      }
      r.outline.set(out, pr.count, true)
      const b = this.buf
      b[0] = 0; b[1] = -14; b[2] = 0; b[3] = hs + 14
      r.cl.set(b, 4)
      const left = pr.zMin * k
      const dx = left - (small ? 14 : 20)
      const yS = (pr.yTop - pr.ySleeve) * k
      b[0] = left - 3; b[1] = 0; b[2] = dx - 6; b[3] = 0
      r.ext1.set(b, 4)
      b[0] = -2; b[1] = yS; b[2] = dx - 6; b[3] = yS
      r.ext2.set(b, 4)
      b[0] = dx; b[1] = 0; b[2] = dx; b[3] = yS
      r.dim.set(b, 4)
      r.ar1.set(this.arr, arrowPts(this.arr, dx, 0, 0, -1, 8, 2.6), true)
      r.ar2.set(this.arr, arrowPts(this.arr, dx, yS, 0, 1, 8, 2.6), true)
      r.text.at(0, 0, 'middle')
      r.text.el.setAttribute('transform', `translate(${(dx - 7).toFixed(1)} ${(yS / 2).toFixed(1)}) rotate(-90)`)
      r.title.at(pr.zMax * k + 2, hs + 32, 'end')
    }
    if (on && !r.c.on) {
      r.c.set(true, 0)
      if (r.drawnOnce) flag(r.c.g, 'drawn', true)
      else window.setTimeout(() => (r.drawnOnce = true), 1800)
    } else if (!on) r.c.set(false)
  }

  // ---- click feedback ------------------------------------------------------
  private updateClick(): void {
    const st = this.st
    const c = this.clickC
    if (st.clickAt !== this.lastClickAt) {
      this.lastClickAt = st.clickAt
      c.at = st.clickAt
      c.c.set(false)
      this.animUntil = performance.now() + 1500
    }
    const age = performance.now() - c.at
    const lead = st.byName.get('lead')
    if (c.at < 0 || age > 1300 || !lead) {
      c.c.set(false)
      return
    }
    this.axisPt(lead, lead.box.min.y, this.t1)
    this.proj(this.t1, this.pA)
    const vis = this.onScreen(this.pA, -20)
    c.c.show(vis)
    c.c.set(vis && age > 100 && age < 1100)
    if (!vis) return
    const side = this.pA.x < st.vp.left + st.vp.w * 0.7 ? 1 : -1
    const b = this.buf
    b[0] = this.pA.x + side * 5; b[1] = this.pA.y + 3
    b[2] = this.pA.x + side * 26; b[3] = this.pA.y + 18
    c.leader.set(b, 4)
    c.text.text(`+0.5 · ${pad2(st.clicks % 100)}`)
    c.text.at(b[2] + side * 5, b[3] + 4, side > 0 ? 'start' : 'end')
  }

  // ---- outlined "9" behind the exploded parts (0.85× parallax) ------------
  private updateNumeral(ex: number): void {
    const n = this.num
    const sec = this.exploded
    if (!n || !sec) return
    const H = this.st.vp.h
    const r = sec.getBoundingClientRect()
    const centre = r.top + r.height / 2
    const y = Math.round((centre - H / 2) * 0.85)
    const near = Math.abs(centre - H / 2) < H * 1.4
    const op = near ? Math.round(ex * (1 - this.st.inkAlpha) * 100) / 100 : 0
    if (op !== this.numOp) {
      this.numOp = op
      n.style.opacity = String(op)
      n.style.visibility = op > 0 ? 'visible' : 'hidden'
    }
    if (op > 0 && y !== this.numY) {
      this.numY = y
      n.style.transform = `translate3d(0,${y}px,0)`
    }
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onCancel)
    this.setHighlight(-1)
    for (const m of this.hiMats.values()) m.dispose()
    this.root?.remove()
    this.num?.remove()
  }
}
