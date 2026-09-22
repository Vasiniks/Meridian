export interface CamKey {
  p: number
  pos: [number, number, number]
  tgt: [number, number, number]
  fov: number
  label: string
}

/** Camera choreography — preserved from the prototype. */
export const KEYS: CamKey[] = [
  { p: 0.0, pos: [3.6, 1.6, 8.8], tgt: [0, 0, 0], fov: 35, label: '01 — Reveal' },
  { p: 0.08, pos: [1.5, -1.2, 3.4], tgt: [0, -1.7, 0], fov: 28, label: '02 — Detail' },
  { p: 0.2, pos: [0, 0.7, 19.2], tgt: [0, 0.7, 0], fov: 40, label: '03 — Exploded' },
  { p: 0.335, pos: [0, 0.7, 17.8], tgt: [0, 0.7, 0], fov: 40, label: '04 — X-Ray' },
  { p: 0.44, pos: [2.2, 4.4, 2.6], tgt: [0, 3.9, 0], fov: 25, label: '05 — Mechanism' },
  { p: 0.56, pos: [-3.4, 1.3, 6.4], tgt: [0, 0, 0], fov: 35, label: '06 — Reassembly' },
  { p: 0.63, pos: [2.8, 1.0, 5.8], tgt: [0, -0.1, 0], fov: 32, label: '07 — Object' },
  // reached at p=0.90 and held through buy
  { p: 0.9, pos: [2.4, 0.7, 6.4], tgt: [0, 0, 0], fov: 33, label: '08 — Lineup' },
]

export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export const explodeF = (p: number): number =>
  sstep(0.15, 0.24, p) * (1 - sstep(0.38, 0.45, p))
export const xrayF = (p: number): number =>
  sstep(0.32, 0.36, p) * (1 - sstep(0.52, 0.57, p))
export const mechF = (p: number): number =>
  sstep(0.44, 0.48, p) * (1 - sstep(0.52, 0.56, p))
export const detailF = (p: number): number =>
  sstep(0.05, 0.08, p) * (1 - sstep(0.13, 0.16, p))
export const heroOffF = (p: number): number => 1 - sstep(0.02, 0.1, p)
export const reOffF = (p: number): number =>
  sstep(0.55, 0.58, p) * (1 - sstep(0.63, 0.68, p))
export const canvasDimF = (p: number): number => 1 - sstep(0.67, 0.72, p)
