import * as THREE from 'three'
import type { MechRole } from '../assembly'
import type { FrameCtx, SceneModule } from '../modules'
import type { Assembly } from '../assembly'
import { explodeF } from '../../data/scroll'
import { bus } from '../../fx/bus'
import { History, Spring } from './spring'
import { type DrawingState, mechStepAt, type NodeInfo } from './state'

/**
 * A real clutch-pencil click (Pentel P205 / Rotring 600 class), in local
 * units (1 = 10 mm), axis +Y toward the cap:
 *
 *  tube  — cap, lead tube and the brass collet, which move as one
 *  lead  — the working lead (advances only while the jaws grip it)
 *
 * The clutch ring and the jaws are never posed directly. The ring floats
 * RING_GAP between the spring seat (rear, its rest position) and the ring
 * stop (front): the collet's cone pushes it forward until it lands on the
 * stop and carries it back on the return, so ring = max(tube, −RING_GAP).
 * The jaws open as the collet slides out of the stopped ring
 * (opening = f(ring − tube)), like the real cone wedge, so no frame can
 * show open jaws inside a seated ring.
 */
interface Pose {
  tube: number
  lead: number
}

/** button stroke (2.5 mm) and clutch-ring travel (0.5 mm = lead advance) */
const STROKE = 0.25
const RING_GAP = 0.05
/** jaw swing about its slot root at full release: mouth moves ~0.2 mm out */
const JAW_OPEN = 0.05
/** ring−tube travel at which the jaws start / finish opening */
const OPEN_A = 0.03
const OPEN_B = 0.2

/** The five moves (index 1..5); 0 = rest. Must match render_views.py MECH_POSES. */
const POSES: Pose[] = [
  { tube: 0, lead: 0 },
  // 01 Press — cap, tube, collet, ring and the gripped lead go forward together
  { tube: -RING_GAP, lead: RING_GAP },
  // 02 Ring stops — the ring lands on its stop; the collet keeps going
  { tube: -0.12, lead: RING_GAP },
  // 03 Jaws open — full stroke: the jaws are out of the ring and spring open
  { tube: -STROKE, lead: RING_GAP },
  // 04 Release — the spring returns the tube; the open jaws slide back up the
  //    lead, which the retainer holds
  { tube: -0.13, lead: RING_GAP },
  // 05 Regrip — the jaws re-enter the ring, close, and carry it back to the
  //    seat; the lead stays 0.5 mm further out
  { tube: 0, lead: RING_GAP },
]

/** A click on the pencil (press phase; release = rest + one lead step). */
const CLICK: Pose = { tube: -STROKE, lead: RING_GAP }
const PRESS_MS = 160
const LEAD_STEP = RING_GAP
const LEAD_MAX = 5 * LEAD_STEP

const TUBE_ROLES: ReadonlySet<MechRole> = new Set<MechRole>(['button', 'tube', 'clutch'])

interface PartRig {
  info: NodeInfo
  role: MechRole
  delay: number
  ex: Spring
  /** spring only: half its installed length (local units) */
  half: number
}

interface JawRig {
  node: THREE.Object3D
  axis: THREE.Vector3
}

/**
 * Parts + mechanism animation:
 *  - explode offsets follow the scroll through near-critical springs with a
 *    40 ms stagger per group (reassembly "snaps back, exactly")
 *  - the five mechanism steps are discrete poses; each step change fires
 *    k=300 c=18 springs → a tiny overshoot = the click
 *  - `pencil:click` plays one full press/release; each click leaves the
 *    lead 0.5 mm further out.
 */
export class MechanismModule implements SceneModule {
  readonly name = 'drawing:mechanism'
  private rigs: PartRig[] = []
  private jaws: JawRig[] = []
  private tube = new Spring(300, 18)
  private lead = new Spring(300, 18)
  private hist = new History(96)
  private clickAt = -1e9
  private leadAdv = 0
  private leadPending = false
  private motionOK = true
  private busy = false
  private off: (() => void) | null = null

  constructor(private st: DrawingState) {}

  init(_stage: unknown, asm: Assembly): void {
    if (this.st.asm !== asm) this.st.build(asm)
    // stagger: groups closest to datum return first, 40 ms apart
    const order = this.st.groups
      .map((g) => ({ g, m: Math.min(...g.nodes.map((n) => Math.abs(n.entry.explode))) }))
      .sort((a, b) => a.m - b.m)
    const delayOf = new Map<number, number>()
    order.forEach((o, i) => delayOf.set(o.g.index, i * 40))
    this.rigs = this.st.nodes.map((info) => ({
      info,
      role: info.entry.mech,
      delay: info.group >= 0 ? (delayOf.get(info.group) ?? 0) : 0,
      ex: new Spring(300, 31),
      half: Math.max(1e-3, info.size.y / 2),
    }))
    this.jaws = asm.jaws.map((j) => ({
      node: j.node,
      // tangent at the jaw: a positive turn swings the mouth (below the
      // hinge) radially outward
      axis: new THREE.Vector3(-Math.sin(j.angle), 0, Math.cos(j.angle)),
    }))
    this.off = bus.on('pencil:click', () => this.click())
  }

  onMotionChange(ok: boolean): void {
    this.motionOK = ok
  }

  wantsFrame(): boolean {
    return this.busy
  }

  /** Play one click (also reachable via bus 'pencil:click'). */
  click(): void {
    const now = performance.now()
    this.st.clickAt = now
    this.st.clicks++
    if (!this.motionOK) {
      this.leadAdv = Math.min(LEAD_MAX, this.leadAdv + LEAD_STEP)
      this.busy = true
      return
    }
    this.clickAt = now
    this.leadPending = true
    this.busy = true
  }

  update(ctx: FrameCtx): void {
    const { p, dt } = ctx
    this.motionOK = ctx.motionOK
    const now = performance.now()
    const ex = explodeF(p)
    this.hist.push(now, ex)

    const step = mechStepAt(p)
    if (step !== this.st.step) {
      this.st.step = step
      bus.emit('mech:step', { index: step, total: 5 })
    }
    // a pencil you clicked in the hero resets once it starts to come apart
    if (ex > 0.02 || step !== 0) this.leadAdv = 0
    const tc = now - this.clickAt
    const pressing = this.motionOK && tc >= 0 && tc < PRESS_MS
    // the lead step is banked the moment the press ends, so the target is
    // continuous: the lead went out with the jaws and stays out
    if (this.leadPending && tc >= PRESS_MS) {
      this.leadPending = false
      if (ex <= 0.02 && step === 0) this.leadAdv = Math.min(LEAD_MAX, this.leadAdv + LEAD_STEP)
    }
    const pose = pressing ? CLICK : POSES[step]
    this.tube.target = pose.tube
    this.lead.target = pose.lead + (step === 0 ? this.leadAdv : 0)
    let busy = pressing || this.leadPending
    if (this.motionOK) {
      this.tube.step(dt)
      this.lead.step(dt)
      if (!(this.tube.settled && this.lead.settled)) busy = true
    } else {
      this.tube.snap()
      this.lead.snap()
    }
    // the click spring may overshoot a hair; the parts may not: the cap
    // stops at full stroke, the collet at its rest, the ring on its stop
    const tube = Math.min(0, Math.max(-STROKE, this.tube.x))
    const ring = Math.max(tube, -RING_GAP)
    const lead = this.lead.x
    const open = Math.min(1, Math.max(0, (ring - tube - OPEN_A) / (OPEN_B - OPEN_A)))
    const ang = open * JAW_OPEN
    for (const j of this.jaws) j.node.quaternion.setFromAxisAngle(j.axis, ang)

    for (const r of this.rigs) {
      const o = r.info.node
      const role = r.role
      const exT = this.motionOK ? this.hist.at(now - r.delay) : ex
      r.ex.target = exT * r.info.entry.explode * 0.7
      if (this.motionOK) {
        r.ex.step(dt)
        if (!busy && !r.ex.settled) busy = true
      } else r.ex.snap()
      let y = r.info.entry.base.y + r.ex.x
      if (TUBE_ROLES.has(role)) y += tube
      else if (role === 'ring') y += ring
      else if (role === 'lead') y += lead
      else if (role === 'spring') {
        // seat end fixed, collet end follows the tube: scale about the
        // centre and slide by half the travel
        y += tube / 2
        o.scale.y = 1 + tube / (2 * r.half)
      }
      o.position.y = y
    }
    this.busy = busy
  }

  dispose(): void {
    this.off?.()
  }
}
