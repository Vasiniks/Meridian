/**
 * Mass-1 damped spring, semi-implicit Euler with fixed sub-steps so large
 * frame deltas never blow up. Presets (brief §2.0): part click k=300 c=18
 * (ζ≈0.52 → a tiny overshoot that reads as a click); reassembly k=300 c=31
 * (ζ≈0.9, "no bounce, no rattle").
 */
export class Spring {
  x = 0
  v = 0
  target = 0
  constructor(
    public k = 300,
    public c = 18,
  ) {}

  step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - this.target) - this.c * this.v
      this.v += a * h
      this.x += this.v * h
    }
  }

  snap(): void {
    this.x = this.target
    this.v = 0
  }

  get settled(): boolean {
    return Math.abs(this.x - this.target) < 2e-4 && Math.abs(this.v) < 2e-3
  }
}

/** Ring buffer of (time, value) so a part can follow a signal with a delay. */
export class History {
  private t: Float64Array
  private v: Float32Array
  private head = -1
  private count = 0
  constructor(private size = 64) {
    this.t = new Float64Array(size)
    this.v = new Float32Array(size)
  }

  push(time: number, value: number): void {
    this.head = (this.head + 1) % this.size
    this.t[this.head] = time
    this.v[this.head] = value
    this.count = Math.min(this.size, this.count + 1)
  }

  /** value at `time` (linear between samples, clamped to the oldest) */
  at(time: number): number {
    if (this.count === 0) return 0
    let i = this.head
    for (let k = 0; k < this.count - 1; k++) {
      const j = (i - 1 + this.size) % this.size
      if (this.t[j] <= time) {
        const t0 = this.t[j]
        const t1 = this.t[i]
        const f = t1 > t0 ? (time - t0) / (t1 - t0) : 1
        return this.v[j] + (this.v[i] - this.v[j]) * Math.min(1, Math.max(0, f))
      }
      i = j
    }
    return this.v[i]
  }
}
