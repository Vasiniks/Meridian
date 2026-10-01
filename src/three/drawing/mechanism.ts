import type { MechRole } from '../assembly'
import type { FrameCtx, SceneModule } from '../modules'
import type { Assembly } from '../assembly'
import { explodeF } from '../../data/scroll'
import { bus } from '../../fx/bus'
import { History, Spring } from './spring'
import { type DrawingState, mechStepAt, type NodeInfo } from './state'

type Offsets = Partial<Record<MechRole, number>>
interface Pose {
  y: Offsets
  /** compression (1 - scale.y) per spring role */
  comp: Offsets
  jaw: number
  jawY: number
}

/** The five moves (index 1..5); 0 = rest. Local units, 1 = 10 mm. */
const POSES: Pose[] = [
  { y: {}, comp: {}, jaw: 0, jawY: 0 },
  // 01 Press — button/stem travel, button spring loads
  { y: { button: -0.22, stem: -0.22, actuator: -0.08 }, comp: { springBtn: 0.32 }, jaw: 0, jawY: 0 },
  // 02 Compress — actuator drives the rod + clutch, return spring stores energy
  {
    y: { button: -0.22, stem: -0.22, actuator: -0.18, rod: -0.14, clutch: -0.06 },
    comp: { springBtn: 0.32, springMain: 0.28, springStab: 0.14 },
    jaw: 0,
    jawY: -0.06,
  },
  // 03 Release — jaws leave the ring and open
  {
    y: { button: -0.22, stem: -0.22, actuator: -0.18, rod: -0.14, clutch: -0.06 },
    comp: { springBtn: 0.32, springMain: 0.28, springStab: 0.14 },
    jaw: 0.16,
    jawY: -0.12,
  },
  // 04 Advance — lead + sleeve feed one increment
  {
    y: { button: -0.22, stem: -0.22, actuator: -0.18, rod: -0.14, clutch: -0.06, lead: 0.12, sleeve: 0.1 },
    comp: { springBtn: 0.32, springMain: 0.28, springStab: 0.14 },
    jaw: 0.16,
    jawY: -0.12,
  },
  // 05 Reset — everything reseats, lead stays one increment out
  { y: { lead: 0.12 }, comp: {}, jaw: 0, jawY: 0 },
]

/** A single click anywhere on the pencil (press phase; release = rest). */
const CLICK: Pose = {
  y: { button: -0.2, stem: -0.2, actuator: -0.1, clutch: -0.04, rod: -0.05 },
  comp: { springBtn: 0.3, springMain: 0.12 },
  jaw: 0.09,
  jawY: -0.05,
}
const PRESS_MS = 150
const LEAD_MS = 120
const LEAD_STEP = 0.04
const LEAD_MAX = 0.16

interface PartRig {
  info: NodeInfo
  role: MechRole
  delay: number
  ex: Spring
  y: Spring
  open: Spring
  scale: Spring
  jawR: number
  jawA: number
}

/**
 * Parts + mechanism animation (replaces the built-in parts block):
 *  - explode offsets follow the scroll through near-critical springs with a
 *    40 ms stagger per group (reassembly "snaps back, exactly")
 *  - the five mechanism steps are discrete poses; each step change fires
 *    k=300 c=18 springs → a tiny overshoot = the click
 *  - `pencil:click` plays one press/release + a hair of lead advance.
 */
export class MechanismModule implements SceneModule {
  readonly name = 'drawing:mechanism'
  private rigs: PartRig[] = []
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
    this.rigs = this.st.nodes.map((info) => {
      const b = info.entry.base
      const r0 = Math.hypot(b.x, b.z)
      return {
        info,
        role: info.entry.mech,
        delay: info.group >= 0 ? (delayOf.get(info.group) ?? 0) : 0,
        ex: new Spring(300, 31),
        y: new Spring(300, 18),
        open: new Spring(300, 18),
        scale: Object.assign(new Spring(300, 18), { x: 1, target: 1 }),
        jawR: r0 > 1e-4 ? r0 : 0.11,
        jawA: r0 > 1e-4 ? Math.atan2(b.z, b.x) : info.entry.jawAngle,
      }
    })
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
    if (this.leadPending && tc >= LEAD_MS) {
      this.leadPending = false
      if (ex <= 0.02 && step === 0) this.leadAdv = Math.min(LEAD_MAX, this.leadAdv + LEAD_STEP)
    }
    const pose = POSES[step]
    const k = pressing ? 1 : 0
    let busy = pressing || this.leadPending

    for (const r of this.rigs) {
      const o = r.info.node
      const role = r.role
      const exT = this.motionOK ? this.hist.at(now - r.delay) : ex
      r.ex.target = exT * r.info.entry.explode * 0.7
      let yT = (pose.y[role] ?? 0) + k * (CLICK.y[role] ?? 0)
      if (role === 'lead') yT += this.leadAdv
      if (role === 'jaw') {
        yT = pose.jawY + k * CLICK.jawY
        r.open.target = pose.jaw + k * CLICK.jaw
      }
      r.y.target = yT
      r.scale.target = 1 - (pose.comp[role] ?? 0) - k * (CLICK.comp[role] ?? 0)
      if (this.motionOK) {
        r.ex.step(dt)
        r.y.step(dt)
        if (role === 'jaw') r.open.step(dt)
        r.scale.step(dt)
        if (!busy && !(r.ex.settled && r.y.settled && r.open.settled && r.scale.settled)) busy = true
      } else {
        r.ex.snap()
        r.y.snap()
        r.open.snap()
        r.scale.snap()
      }
      const y = r.info.entry.base.y + r.ex.x + r.y.x
      if (role === 'jaw') {
        const open = r.open.x + ex * 0.1
        o.position.set(Math.cos(r.jawA) * (r.jawR + open), y, Math.sin(r.jawA) * (r.jawR + open))
        continue
      }
      o.position.y = y
      if (role === 'springMain' || role === 'springBtn' || role === 'springStab') o.scale.y = r.scale.x
    }
    this.busy = busy
  }

  dispose(): void {
    this.off?.()
  }
}
