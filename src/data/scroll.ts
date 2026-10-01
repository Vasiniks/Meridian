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
  // Lineup + buy: the ring module (src/three/ring.ts) takes the camera over
  // from here with its own section-local framing, so this key only holds
  // the Object framing (and flips the scene label as the lineup pins).
  { p: 0.65, pos: [2.8, 1.0, 5.8], tgt: [0, -0.1, 0], fov: 32, label: '08 — Lineup' },
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
export const canvasDimF = (_p: number): number => 1

// ---- lineup ring mapping ----------------------------------------------
// Everything below is SECTION-LOCAL so it survives resizes and layout
// changes elsewhere on the page: `u` is the scroll distance from the
// moment #lineup pins, in viewport heights (u<0 approaching, 0..PIN pinned,
// >PIN unpinning into Buy). The 3D ring, the DOM overlay, the static
// CSS ring and the dial all read these same numbers.

/** #lineup height in viewport heights (kept at 4 so page-progress keys elsewhere stay put). */
export const LINEUP_VH = 4
/** pinned scroll distance, in viewport heights */
export const LINEUP_PIN = LINEUP_VH - 1
export const LINEUP_COUNT = 4

/**
 * Detent layout (u). The ring rests on a variant between moves and swings
 * to the next one inside each [start, end] window. The last move (into
 * Limited) is ~1.3x longer: the crescendo.
 */
export const RING_MOVES: ReadonlyArray<readonly [number, number]> = [
  [0.55, 0.91],
  [1.36, 1.72],
  [2.17, 2.64],
]
/** Plateau centres: where click / drag / dial navigation parks each variant. */
export const RING_SNAPS: readonly number[] = [0.34, 1.135, 1.945, 2.84]
/** Handoff: hero pencil glides into the front slot, siblings rise in. */
export const RING_IN: readonly [number, number] = [-0.62, 0.12]
/** Siblings materialize window (staggered inside it). */
export const RING_RISE: readonly [number, number] = [-0.42, 0.3]
/** Exit: unselected pencils sink, the presenter flies into the Buy slot. */
export const RING_SINK: readonly [number, number] = [2.96, 3.5]
export const RING_OUT: readonly [number, number] = [3.0, 3.8]

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Scroll-mapped ring position 0..COUNT-1 (integer = a variant at rest in front). */
export function ringTarget(u: number): number {
  let pos = 0
  for (let i = 0; i < RING_MOVES.length; i++) {
    const [a, b] = RING_MOVES[i]
    if (u <= a) break
    pos = i + (u >= b ? 1 : easeInOutCubic((u - a) / (b - a)))
    if (u < b) break
  }
  return pos
}

/** Nearest resting ring index for a (possibly mid-swing) position. */
export const ringIndex = (pos: number): number =>
  Math.min(LINEUP_COUNT - 1, Math.max(0, Math.round(pos)))

/** True while u sits inside a move window (the ring is between detents). */
export function ringMoving(u: number): number {
  for (let i = 0; i < RING_MOVES.length; i++) {
    const [a, b] = RING_MOVES[i]
    if (u > a && u < b) return i
  }
  return -1
}
