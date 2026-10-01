/**
 * Graphite cursor trail — a 0.5 mm lead line that follows the pointer.
 *
 * - Width from velocity (perfect-freehand style pressure simulation, but
 *   time-based so it doesn't depend on the mouse's event rate): slow strokes
 *   lay down more graphite, fast flicks draw thin.
 * - Fades by *thinning*, not alpha: r_i = w_i · (1 − age/life)^1.3, so the
 *   tail retracts into the nib and nothing remains ~0.9 s after you stop.
 * - One filled outline per frame with a pre-generated graphite-grain
 *   pattern (anchored to the canvas, so the paper tooth stays still while
 *   the line moves) and `mix-blend-mode: multiply` on the canvas.
 * - Ring buffers + scratch Float32Arrays: zero allocations per frame. Only
 *   the previous frame's bounding box is cleared.
 */
const CAP = 192

export interface TrailOptions {
  life: number
  size: number
  thin: number
  alpha: number
}

function graphiteTile(): HTMLCanvasElement {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const img = g.createImageData(S, S)
  // two octaves of tileable value noise
  const grid = (n: number): Float32Array => {
    const a = new Float32Array(n * n)
    for (let i = 0; i < a.length; i++) a[i] = Math.random()
    return a
  }
  const g1 = grid(16)
  const g2 = grid(64)
  const sample = (a: Float32Array, n: number, x: number, y: number): number => {
    const fx = (x / S) * n
    const fy = (y / S) * n
    const x0 = Math.floor(fx) % n
    const y0 = Math.floor(fy) % n
    const x1 = (x0 + 1) % n
    const y1 = (y0 + 1) % n
    const tx = fx - Math.floor(fx)
    const ty = fy - Math.floor(fy)
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const top = a[y0 * n + x0] + (a[y0 * n + x1] - a[y0 * n + x0]) * sx
    const bot = a[y1 * n + x0] + (a[y1 * n + x1] - a[y1 * n + x0]) * sx
    return top + (bot - top) * sy
  }
  // faint 15° fibre streaks
  const ang = (15 * Math.PI) / 180
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = 0.62 * sample(g1, 16, x, y) + 0.38 * sample(g2, 64, x, y)
      const u = x * ca + y * sa
      const fibre = 0.5 + 0.5 * Math.sin(u * 1.9 + Math.sin(y * 0.21) * 2.2)
      const grain = Math.random()
      let a = 0.55 + 0.45 * n - 0.1 * fibre * fibre + (grain - 0.5) * 0.22
      a = a < 0.3 ? 0.3 : a > 1 ? 1 : a
      const i = (y * S + x) * 4
      img.data[i] = 0x2e
      img.data[i + 1] = 0x2d
      img.data[i + 2] = 0x2b
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

export class GraphiteTrail {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private o: TrailOptions
  private dpr = 1
  private tile: HTMLCanvasElement
  // ring buffer of samples
  private xs = new Float32Array(CAP)
  private ys = new Float32Array(CAP)
  private ts = new Float64Array(CAP)
  private ws = new Float32Array(CAP)
  private brk = new Uint8Array(CAP)
  private tail = 0
  private count = 0
  // scratch outline
  private lx = new Float32Array(CAP)
  private ly = new Float32Array(CAP)
  private rx = new Float32Array(CAP)
  private ry = new Float32Array(CAP)
  private rr = new Float32Array(CAP)
  // input state
  private hasLast = false
  private sx = 0
  private sy = 0
  private lastT = 0
  private rawX = 0
  private rawY = 0
  private pressed = false
  private pressure = 0.4
  private strokeLen = 0
  // previous dirty rect (CSS px)
  private bx0 = 0
  private by0 = 0
  private bx1 = 0
  private by1 = 0
  private dirty = false
  // the multiply-blended canvas is display:none while empty (no blend cost)
  private idle = true

  private setIdle(v: boolean): void {
    if (v === this.idle) return
    this.idle = v
    this.canvas.classList.toggle('is-idle', v)
  }

  constructor(o: Partial<TrailOptions> = {}) {
    this.o = { life: 900, size: 1.8, thin: 0.6, alpha: 0.72, ...o }
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'graphite'
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.className = 'is-idle'
    this.ctx = this.canvas.getContext('2d')!
    this.tile = graphiteTile()
    this.resize()
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const pat = ctx.createPattern(this.tile, 'repeat')
    if (pat) {
      // one tile texel per device pixel: finer, paper-scale tooth
      pat.setTransform(new DOMMatrix([1 / this.dpr, 0, 0, 1 / this.dpr, 0, 0]))
      ctx.fillStyle = pat
    } else ctx.fillStyle = '#2E2D2B'
    ctx.globalAlpha = this.o.alpha
    this.dirty = false
  }

  /** Pencil leaves the paper: the next sample starts a new stroke. */
  lift(): void {
    this.hasLast = false
  }

  get active(): boolean {
    return this.count > 0 || this.dirty
  }

  /** Feed a pointer sample (client px, event timeStamp ms). */
  add(x: number, y: number, t: number, pressed: boolean): void {
    this.rawX = x
    this.rawY = y
    this.pressed = pressed
    if (!this.hasLast) {
      this.hasLast = true
      this.sx = x
      this.sy = y
      this.lastT = t
      this.pressure = 0.45
      this.strokeLen = 0
      this.push(x, y, t, this.width(0), 1)
      return
    }
    this.step(t)
  }

  /** Streamline toward the raw pointer and lay down a sample. */
  private step(t: number): void {
    // streamline (perfect-freehand): trail the raw input a little
    const nx = this.sx + (this.rawX - this.sx) * 0.42
    const ny = this.sy + (this.rawY - this.sy) * 0.42
    const dx = nx - this.sx
    const dy = ny - this.sy
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < 0.6) return
    const dtm = Math.max(1, t - this.lastT)
    const speed = d / dtm // px per ms
    // pressure sim: slow → heavier line; pressing the button bears down
    const target = this.pressed ? 1 : 1 - Math.min(1, speed / 2.4)
    this.pressure += (target - this.pressure) * (1 - Math.exp(-dtm / 70))
    this.sx = nx
    this.sy = ny
    this.lastT = t
    this.strokeLen++
    // taper-in over the first samples of each stroke
    const taper = Math.min(1, (this.strokeLen + 1) / 7)
    this.push(nx, ny, t, this.width(this.pressure) * taper, 0)
  }

  private width(p: number): number {
    const { size, thin } = this.o
    return size * (0.5 - thin * (0.5 - p))
  }

  private push(x: number, y: number, t: number, w: number, b: number): void {
    const i = (this.tail + this.count) % CAP
    this.xs[i] = x
    this.ys[i] = y
    this.ts[i] = t
    this.ws[i] = w
    this.brk[i] = b
    if (this.count < CAP) this.count++
    else this.tail = (this.tail + 1) % CAP
    this.setIdle(false)
  }

  /** Clear everything immediately (motion turned off, resize). */
  clear(): void {
    this.count = 0
    this.hasLast = false
    if (this.dirty) {
      this.ctx.clearRect(this.bx0, this.by0, this.bx1 - this.bx0, this.by1 - this.by0)
      this.dirty = false
    }
    this.setIdle(true)
  }

  /** Draw one frame; returns true while anything is still visible. */
  frame(now: number): boolean {
    const { life } = this.o
    // let the streamlined head catch up with a pointer that has stopped
    if (this.hasLast && this.count > 0) this.step(now)
    // expire from the tail
    while (this.count > 0 && now - this.ts[this.tail] > life) {
      this.tail = (this.tail + 1) % CAP
      this.count--
      if (this.count > 0) this.brk[this.tail] = 1
    }
    const ctx = this.ctx
    if (this.dirty) {
      ctx.clearRect(this.bx0, this.by0, this.bx1 - this.bx0, this.by1 - this.by0)
      this.dirty = false
    }
    const n = this.count
    if (n < 2) {
      if (n === 0) this.setIdle(true)
      return n > 0
    }

    const { xs, ys, ts, ws, brk, lx, ly, rx, ry, rr } = this
    let x0 = 1e9
    let y0 = 1e9
    let x1 = -1e9
    let y1 = -1e9
    let maxR = 0
    ctx.beginPath()
    let start = 0
    while (start < n) {
      // a run = samples until the next stroke break
      let end = start + 1
      while (end < n && brk[(this.tail + end) % CAP] === 0) end++
      const len = end - start
      if (len >= 2) {
        for (let k = 0; k < len; k++) {
          const i = (this.tail + start + k) % CAP
          const ia = (this.tail + start + Math.max(0, k - 1)) % CAP
          const ib = (this.tail + start + Math.min(len - 1, k + 1)) % CAP
          let nx = -(ys[ib] - ys[ia])
          let ny = xs[ib] - xs[ia]
          const m = Math.sqrt(nx * nx + ny * ny) || 1
          nx /= m
          ny /= m
          const age = (now - ts[i]) / life
          const f = age >= 1 ? 0 : Math.pow(1 - age, 1.3)
          const r = ws[i] * f
          rr[k] = r
          lx[k] = xs[i] + nx * r
          ly[k] = ys[i] + ny * r
          rx[k] = xs[i] - nx * r
          ry[k] = ys[i] - ny * r
          if (xs[i] < x0) x0 = xs[i]
          if (xs[i] > x1) x1 = xs[i]
          if (ys[i] < y0) y0 = ys[i]
          if (ys[i] > y1) y1 = ys[i]
          if (r > maxR) maxR = r
        }
        // left edge (tail → head) through midpoints for a smooth outline
        ctx.moveTo(lx[0], ly[0])
        for (let k = 1; k < len - 1; k++) {
          ctx.quadraticCurveTo(lx[k], ly[k], (lx[k] + lx[k + 1]) * 0.5, (ly[k] + ly[k + 1]) * 0.5)
        }
        ctx.lineTo(lx[len - 1], ly[len - 1])
        // round cap at the head (the nib)
        const ih = (this.tail + start + len - 1) % CAP
        const an = Math.atan2(ly[len - 1] - ys[ih], lx[len - 1] - xs[ih])
        if (rr[len - 1] > 0.05) ctx.arc(xs[ih], ys[ih], rr[len - 1], an, an - Math.PI, true)
        ctx.lineTo(rx[len - 1], ry[len - 1])
        // right edge back (head → tail)
        for (let k = len - 2; k > 0; k--) {
          ctx.quadraticCurveTo(rx[k], ry[k], (rx[k] + rx[k - 1]) * 0.5, (ry[k] + ry[k - 1]) * 0.5)
        }
        ctx.lineTo(rx[0], ry[0])
        ctx.closePath()
      }
      start = end
    }
    ctx.fill()
    const pad = maxR + 3
    this.bx0 = Math.max(0, Math.floor(x0 - pad))
    this.by0 = Math.max(0, Math.floor(y0 - pad))
    this.bx1 = Math.ceil(x1 + pad)
    this.by1 = Math.ceil(y1 + pad)
    this.dirty = true
    return true
  }
}
